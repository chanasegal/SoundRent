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
        CancellationToken cancellationToken)
    {
        var orders = await _orderService.GetWeeklyOrdersAsync(startDate, endDate, cancellationToken);
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

    /// <summary>Recent accessory-only unpaid orders created via Quick Loan.</summary>
    [HttpGet("quick-loans")]
    public async Task<ActionResult<List<OrderDto>>> GetQuickLoans(CancellationToken cancellationToken)
    {
        var orders = await _orderService.GetQuickLoansAsync(cancellationToken);
        return Ok(orders);
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
}

public record SlotTakenResponse(bool Taken);
