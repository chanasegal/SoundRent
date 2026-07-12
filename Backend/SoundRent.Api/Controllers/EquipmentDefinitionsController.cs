using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Infrastructure.Data;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class EquipmentDefinitionsController : ControllerBase
{
    private readonly IEquipmentDefinitionRepository _repository;
    private readonly IOrderRepository _orderRepository;
    private readonly AppDbContext _db;

    public EquipmentDefinitionsController(
        IEquipmentDefinitionRepository repository,
        IOrderRepository orderRepository,
        AppDbContext db)
    {
        _repository = repository;
        _orderRepository = orderRepository;
        _db = db;
    }

    [HttpGet]
    [AllowAnonymous]
    public async Task<ActionResult<List<EquipmentDefinitionDto>>> GetAll(CancellationToken cancellationToken)
    {
        var rows = await _repository.GetAllOrderedAsync(cancellationToken);
        return Ok(rows.Select(ToDto).ToList());
    }

    /// <summary>
    /// Returns every equipment definition with an <c>isOccupied</c> flag for the
    /// requested shifts in a single optimized query (no per-item availability calls).
    /// </summary>
    [HttpPost("availability")]
    public async Task<ActionResult<List<EquipmentDefinitionAvailabilityDto>>> GetAvailability(
        [FromBody] EquipmentAvailabilityRequestDto request,
        CancellationToken cancellationToken)
    {
        var shifts = request.Shifts ?? [];
        var occupied = await _orderRepository.GetOccupiedEquipmentIdsForShiftsAsync(
            shifts,
            request.ExcludeOrderId,
            cancellationToken);
        var rows = await _repository.GetAllOrderedAsync(cancellationToken);
        return Ok(rows.Select(r => new EquipmentDefinitionAvailabilityDto
        {
            Id = r.Id,
            DisplayName = r.DisplayName,
            Category = r.Category,
            SortOrder = r.SortOrder,
            IsUnderMaintenance = r.IsMaintenanceMode,
            IsOccupied = occupied.Contains(r.Id)
        }).ToList());
    }

    [HttpPatch("{id}/maintenance")]
    public async Task<ActionResult<EquipmentDefinitionDto>> SetMaintenanceMode(
        string id,
        [FromBody] EquipmentMaintenanceUpdateDto dto,
        CancellationToken cancellationToken)
    {
        var entity = await _repository.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("הגדרת הציוד לא נמצאה");

        entity.IsMaintenanceMode = dto.IsMaintenanceMode;
        await _repository.SaveChangesAsync(cancellationToken);

        return Ok(ToDto(entity));
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<EquipmentDefinitionDto>> Update(
        string id,
        [FromBody] EquipmentDefinitionUpdateDto dto,
        CancellationToken cancellationToken)
    {
        var entity = await _repository.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("הגדרת הציוד לא נמצאה");

        var displayName = dto.DisplayName.Trim();
        if (string.IsNullOrEmpty(displayName))
        {
            throw new ValidationException("יש להזין שם תצוגה");
        }

        entity.DisplayName = displayName;
        entity.SortOrder = dto.SortOrder;
        await _repository.SaveChangesAsync(cancellationToken);

        return Ok(ToDto(entity));
    }

    [HttpPost]
    public async Task<ActionResult<EquipmentDefinitionDto>> Create(
        [FromBody] EquipmentDefinitionCreateDto dto,
        CancellationToken cancellationToken)
    {
        var trimmedId = dto.Id.Trim();
        if (string.IsNullOrEmpty(trimmedId))
        {
            throw new ValidationException("מזהה התא לא יכול להיות ריק");
        }

        if (!IsValidItemCode(trimmedId))
        {
            throw new ValidationException("קוד פריט לא תקין: אותיות באנגלית, מספרים, מקף ונקודה בלבד");
        }

        if (await _repository.ExistsAsync(trimmedId, cancellationToken))
        {
            throw new ValidationException("מזהה זה כבר קיים במערכת");
        }

        var entity = new EquipmentDefinition
        {
            Id = trimmedId,
            DisplayName = dto.DisplayName.Trim(),
            Category = dto.Category.Trim(),
            SortOrder = dto.SortOrder,
            IsMaintenanceMode = false
        };

        await _repository.AddAsync(entity, cancellationToken);
        await _repository.SaveChangesAsync(cancellationToken);

        return StatusCode(StatusCodes.Status201Created, ToDto(entity));
    }

    /// <summary>
    /// Creates one definition per item code. Does not modify existing definitions or orders.
    /// </summary>
    [HttpPost("batch")]
    public async Task<ActionResult<List<EquipmentDefinitionDto>>> CreateBatch(
        [FromBody] EquipmentDefinitionBatchCreateDto dto,
        CancellationToken cancellationToken)
    {
        var displayName = (dto.DisplayName ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(displayName))
        {
            throw new ValidationException("יש להזין שם פריט");
        }

        var category = (dto.Category ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(category))
        {
            throw new ValidationException("יש לבחור קטגוריה");
        }

        var codes = NormalizeItemCodes(dto.ItemCodes);
        if (codes.Count == 0)
        {
            throw new ValidationException("יש להזין לפחות קוד פריט אחד");
        }

        var existing = await _repository.GetByIdsAsync(codes, cancellationToken);
        if (existing.Count > 0)
        {
            var conflict = string.Join(", ", existing.Select(e => e.Id).OrderBy(id => id));
            throw new ValidationException($"קוד פריט כבר קיים במערכת: {conflict}");
        }

        var allRows = await _repository.GetAllOrderedAsync(cancellationToken);
        var nextOrder = allRows.Count == 0 ? 0 : allRows.Max(r => r.SortOrder) + 1;

        var created = new List<EquipmentDefinition>(codes.Count);
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            for (var i = 0; i < codes.Count; i++)
            {
                var entity = new EquipmentDefinition
                {
                    Id = codes[i],
                    DisplayName = displayName,
                    Category = category,
                    SortOrder = nextOrder + i,
                    IsMaintenanceMode = false
                };
                await _repository.AddAsync(entity, cancellationToken);
                created.Add(entity);
            }

            await _repository.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }

        return StatusCode(StatusCodes.Status201Created, created.Select(ToDto).ToList());
    }

    private static List<string> NormalizeItemCodes(IEnumerable<string>? rawCodes)
    {
        var result = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var raw in rawCodes ?? [])
        {
            var trimmed = (raw ?? string.Empty).Trim();
            if (trimmed.Length == 0)
            {
                throw new ValidationException("לא ניתן להשאיר קוד פריט ריק");
            }

            if (trimmed.Length > 64)
            {
                throw new ValidationException($"קוד פריט ארוך מדי: {trimmed}");
            }

            if (!IsValidItemCode(trimmed))
            {
                throw new ValidationException($"קוד פריט לא תקין ({trimmed}): אותיות באנגלית, מספרים, מקף ונקודה בלבד");
            }

            if (!seen.Add(trimmed))
            {
                throw new ValidationException($"קוד פריט כפול: {trimmed}");
            }

            result.Add(trimmed);
        }

        return result;
    }

    private static bool IsValidItemCode(string code) =>
        code.Length > 0
        && char.IsLetterOrDigit(code[0])
        && code.All(ch => char.IsLetterOrDigit(ch) || ch is '.' or '_' or '-');

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id, CancellationToken cancellationToken)
    {
        var entity = await _repository.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("הגדרת הציוד לא נמצאה");

        var todayIsrael = IsraelDateHelper.TodayInIsrael();
        var futureOrders = await _orderRepository.GetFutureOrdersForEquipmentTypeAsync(
            entity.Id,
            todayIsrael,
            cancellationToken);

        if (futureOrders.Count > 0)
        {
            return BadRequest(new EquipmentDefinitionDeleteBlockedResponseDto
            {
                Message = "לא ניתן למחוק תא שיש בו הזמנות מהיום או לעתיד",
                Code = "SLOT_HAS_FUTURE_ORDERS",
                FutureOrders = futureOrders
            });
        }

        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            await _orderRepository.DeleteOrdersForEquipmentTypeBeforeDateAsync(
                entity.Id,
                todayIsrael,
                cancellationToken);
            _repository.Remove(entity);
            await _repository.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }

        return NoContent();
    }

    private static EquipmentDefinitionDto ToDto(EquipmentDefinition r) => new()
    {
        Id = r.Id,
        DisplayName = r.DisplayName,
        Category = r.Category,
        SortOrder = r.SortOrder,
        IsUnderMaintenance = r.IsMaintenanceMode
    };
}
