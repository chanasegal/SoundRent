using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Services;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    private readonly IOrderService _orderService;

    public OrdersController(IOrderService orderService)
    {
        _orderService = orderService;
    }

    [HttpGet("weekly")]
    public async Task<ActionResult<List<OrderDto>>> GetWeekly(
        [FromQuery] DateOnly startDate,
        [FromQuery] DateOnly endDate,
        [FromQuery] SystemType? systemType,
        CancellationToken cancellationToken)
    {
        var orders = await _orderService.GetWeeklyOrdersAsync(
            startDate,
            endDate,
            systemType ?? SystemType.Tools,
            cancellationToken);
        return Ok(orders);
    }

    /// <summary>Full-database order list for Excel backup (past, today, and future).</summary>
    [HttpGet("export-all")]
    public async Task<ActionResult<List<OrderDto>>> ExportAll(CancellationToken cancellationToken)
    {
        var orders = await _orderService.GetAllOrdersForExportAsync(cancellationToken);
        return Ok(orders);
    }

    [HttpGet("unreturned")]
    public async Task<ActionResult<List<UnreturnedItemDto>>> GetUnreturned(CancellationToken cancellationToken)
    {
        var items = await _orderService.GetUnreturnedItemsAsync(cancellationToken);
        return Ok(items);
    }

    /// <summary>Create a standalone missing item (no order required).</summary>
    [HttpPost("unreturned/manual")]
    public async Task<ActionResult<UnreturnedItemDto>> CreateManualUnreturned(
        [FromBody] CreateManualUnreturnedItemDto dto,
        CancellationToken cancellationToken)
    {
        try
        {
            var created = await _orderService.CreateManualUnreturnedItemAsync(dto, cancellationToken);
            return StatusCode(StatusCodes.Status201Created, created);
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>Mark a standalone missing item as returned / resolved.</summary>
    [HttpPost("unreturned/manual/{id:int}/resolve")]
    public async Task<IActionResult> ResolveManualUnreturned(int id, CancellationToken cancellationToken)
    {
        try
        {
            await _orderService.ResolveManualUnreturnedItemAsync(id, cancellationToken);
            return NoContent();
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>Recent accessory-only unpaid orders created via Quick Loan.</summary>
    [HttpGet("quick-loans")]
    public async Task<ActionResult<List<OrderDto>>> GetQuickLoans(CancellationToken cancellationToken)
    {
        var orders = await _orderService.GetQuickLoansAsync(cancellationToken);
        return Ok(orders);
    }

    /// <summary>Active free-text (one-time) accessory loans with no inventory catalog row.</summary>
    [HttpGet("active-one-time-accessories")]
    public async Task<ActionResult<List<ActiveOneTimeAccessoryLoanDto>>> GetActiveOneTimeAccessories(
        CancellationToken cancellationToken)
    {
        var items = await _orderService.GetActiveOneTimeAccessoryLoansAsync(cancellationToken);
        return Ok(items);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<OrderDto>> GetById(int id, CancellationToken cancellationToken)
    {
        var order = await _orderService.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("ההזמנה לא נמצאה");

        return Ok(order);
    }

    [HttpPost]
    public async Task<ActionResult<OrderDto>> Create(
        [FromBody] OrderCreateUpdateDto dto,
        CancellationToken cancellationToken)
    {
        try
        {
            var created = await _orderService.CreateOrderAsync(dto, cancellationToken);
            return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<OrderDto>> Update(
        int id,
        [FromBody] OrderCreateUpdateDto dto,
        CancellationToken cancellationToken)
    {
        try
        {
            var updated = await _orderService.UpdateOrderAsync(id, dto, cancellationToken);
            return Ok(updated);
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        await _orderService.DeleteOrderAsync(id, cancellationToken);
        return NoContent();
    }

    /// <summary>
    /// Lightweight availability check used by the order form to surface a
    /// non-blocking warning when a duplicate booking is detected. Purely
    /// informational — saving an order is always allowed.
    /// </summary>
    [HttpGet("slot-taken")]
    public async Task<ActionResult<SlotTakenResponse>> IsSlotTaken(
        [FromQuery] string equipmentType,
        [FromQuery] DateOnly orderDate,
        [FromQuery] TimeSlot timeSlot,
        [FromQuery] int? excludeOrderId,
        CancellationToken cancellationToken)
    {
        var taken = await _orderService.IsSlotTakenAsync(
            equipmentType, orderDate, timeSlot, excludeOrderId, cancellationToken);
        return Ok(new SlotTakenResponse(taken));
    }

    /// <summary>
    /// Soft probe: another active order for the same institution on the same calendar day.
    /// Informational only — saving remains allowed.
    /// </summary>
    [HttpGet("check-institution-conflict")]
    public async Task<ActionResult<InstitutionConflictDto>> CheckInstitutionConflict(
        [FromQuery] string? institutionName,
        [FromQuery] int? institutionId,
        [FromQuery] DateOnly date,
        [FromQuery] int? excludeOrderId,
        CancellationToken cancellationToken)
    {
        var result = await _orderService.CheckInstitutionConflictAsync(
            institutionName, institutionId, date, excludeOrderId, cancellationToken);
        return Ok(result);
    }

    [HttpPost("{id:int}/cancel")]
    public async Task<ActionResult<OrderDto>> Cancel(int id, CancellationToken cancellationToken)
    {
        try
        {
            var order = await _orderService.CancelOrderAsync(id, cancellationToken);
            return Ok(order);
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("{id:int}/mark-as-paid")]
    public async Task<ActionResult<OrderDto>> MarkAsPaid(int id, CancellationToken cancellationToken)
    {
        var order = await _orderService.MarkOrderAsPaidAsync(id, cancellationToken);
        return Ok(order);
    }

    /// <summary>Lightweight update for the weekly-board urgent note only.</summary>
    [HttpPatch("{id:int}/urgent-board-note")]
    public async Task<ActionResult<OrderDto>> UpdateUrgentBoardNote(
        int id,
        [FromBody] UrgentBoardNoteUpdateDto dto,
        CancellationToken cancellationToken)
    {
        var order = await _orderService.UpdateUrgentBoardNoteAsync(
            id,
            dto.UrgentBoardNote,
            cancellationToken);
        return Ok(order);
    }

    [HttpPost("{id:int}/return")]
    public async Task<ActionResult<OrderDto>> RecordReturn(
        int id,
        [FromBody] OrderReturnRequestDto request,
        CancellationToken cancellationToken)
    {
        try
        {
            var order = await _orderService.RecordReturnAsync(id, request, cancellationToken);
            return Ok(order);
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>
    /// Manually mark loaned items as not returned; updates order return state
    /// so the unreturned report and order details stay in sync.
    /// </summary>
    [HttpPost("{id:int}/mark-unreturned")]
    public async Task<ActionResult<OrderDto>> MarkUnreturned(
        int id,
        [FromBody] MarkUnreturnedRequestDto request,
        CancellationToken cancellationToken)
    {
        try
        {
            var order = await _orderService.MarkUnreturnedAsync(id, request, cancellationToken);
            return Ok(order);
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}

public record SlotTakenResponse(bool Taken);
