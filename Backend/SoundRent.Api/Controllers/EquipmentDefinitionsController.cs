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
