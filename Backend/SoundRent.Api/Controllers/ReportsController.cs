using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Services;

namespace SoundRent.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/reports")]
public class ReportsController : ControllerBase
{
    private readonly IOrderService _orderService;
    private readonly IOpenDebtService _openDebts;

    public ReportsController(IOrderService orderService, IOpenDebtService openDebts)
    {
        _orderService = orderService;
        _openDebts = openDebts;
    }

    [HttpGet("cancelled-orders")]
    public async Task<ActionResult<List<OrderDto>>> GetCancelledOrders(CancellationToken cancellationToken)
    {
        var orders = await _orderService.GetCancelledOrdersAsync(cancellationToken);
        return Ok(orders);
    }

    /// <summary>Manually record a cancelled order without an existing booking.</summary>
    [HttpPost("cancelled-orders")]
    public async Task<ActionResult<OrderDto>> CreateManualCancelledOrder(
        [FromBody] CreateManualCancelledOrderDto dto,
        CancellationToken cancellationToken)
    {
        try
        {
            var created = await _orderService.CreateManualCancelledOrderAsync(dto, cancellationToken);
            return Ok(created);
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>Update an existing cancelled order (manual cancelled-order editor).</summary>
    [HttpPut("cancelled-orders/{id:int}")]
    public async Task<ActionResult<OrderDto>> UpdateManualCancelledOrder(
        int id,
        [FromBody] CreateManualCancelledOrderDto dto,
        CancellationToken cancellationToken)
    {
        try
        {
            var updated = await _orderService.UpdateManualCancelledOrderAsync(id, dto, cancellationToken);
            return Ok(updated);
        }
        catch (NotFoundException)
        {
            return NotFound();
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpGet("unpaid-orders")]
    public async Task<ActionResult<List<OrderDto>>> GetUnpaidOrders(CancellationToken cancellationToken)
    {
        var orders = await _orderService.GetUnpaidOrdersAsync(cancellationToken);
        return Ok(orders);
    }

    /// <summary>Unified open debts (orders + tool return charges), grouped by customer/day/category.</summary>
    [HttpGet("open-debts")]
    public async Task<ActionResult<List<OpenDebtGroupDto>>> GetOpenDebts(CancellationToken cancellationToken)
    {
        return Ok(await _openDebts.GetOpenDebtGroupsAsync(cancellationToken));
    }

    [HttpGet("open-debts/{debtId:int}")]
    public async Task<ActionResult<OpenDebtDetailDto>> GetOpenDebt(
        int debtId,
        CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _openDebts.GetDebtAsync(debtId, cancellationToken));
        }
        catch (NotFoundException)
        {
            return NotFound();
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>Manually record an open debt (customer + category + equipment + amount).</summary>
    [HttpPost("open-debts")]
    public async Task<ActionResult<CreatedOpenDebtDto>> CreateOpenDebt(
        [FromBody] CreateOpenDebtDto dto,
        CancellationToken cancellationToken)
    {
        try
        {
            var created = await _openDebts.CreateDebtAsync(dto, cancellationToken);
            return Ok(created);
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("open-debts/{debtId:int}")]
    public async Task<ActionResult<CreatedOpenDebtDto>> UpdateOpenDebt(
        int debtId,
        [FromBody] UpdateOpenDebtDto dto,
        CancellationToken cancellationToken)
    {
        try
        {
            var updated = await _openDebts.UpdateDebtAsync(debtId, dto, cancellationToken);
            return Ok(updated);
        }
        catch (NotFoundException)
        {
            return NotFound();
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    /// <summary>Update an unpaid order that appears as an open-debt group.</summary>
    [HttpPut("open-debts/orders/{orderId:int}")]
    public async Task<ActionResult<CreatedOpenDebtDto>> UpdateOpenDebtOrder(
        int orderId,
        [FromBody] UpdateOpenDebtDto dto,
        CancellationToken cancellationToken)
    {
        try
        {
            var updated = await _openDebts.UpdateOrderDebtAsync(orderId, dto, cancellationToken);
            return Ok(updated);
        }
        catch (NotFoundException)
        {
            return NotFound();
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("open-debts/delete")]
    public async Task<IActionResult> DeleteOpenDebtGroup(
        [FromBody] MarkOpenDebtGroupPaidDto dto,
        CancellationToken cancellationToken)
    {
        try
        {
            await _openDebts.DeleteGroupAsync(dto, cancellationToken);
            return NoContent();
        }
        catch (NotFoundException)
        {
            return NotFound();
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPost("open-debts/mark-paid")]
    public async Task<IActionResult> MarkOpenDebtGroupPaid(
        [FromBody] MarkOpenDebtGroupPaidDto dto,
        CancellationToken cancellationToken)
    {
        await _openDebts.MarkGroupPaidAsync(dto, cancellationToken);
        return NoContent();
    }

    /// <summary>Mark a single customer debt as paid (Returns page quick-pay).</summary>
    [HttpPost("open-debts/{debtId:int}/mark-paid")]
    public async Task<IActionResult> MarkSingleDebtPaid(int debtId, CancellationToken cancellationToken)
    {
        await _openDebts.MarkDebtPaidAsync(debtId, cancellationToken);
        return NoContent();
    }
}
