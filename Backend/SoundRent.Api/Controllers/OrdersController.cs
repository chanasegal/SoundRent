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
        CancellationToken cancellationToken)
    {
        var orders = await _orderService.GetWeeklyOrdersAsync(startDate, cancellationToken);
        return Ok(orders);
    }

    /// <summary>Full-database order list for Excel backup (past, today, and future).</summary>
    [HttpGet("export-all")]
    public async Task<ActionResult<List<OrderDto>>> ExportAll(CancellationToken cancellationToken)
    {
        var orders = await _orderService.GetAllOrdersForExportAsync(cancellationToken);
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
}

public record SlotTakenResponse(bool Taken);
