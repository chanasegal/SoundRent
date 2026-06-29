using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Services;

namespace SoundRent.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/reports")]
public class ReportsController : ControllerBase
{
    private readonly IOrderService _orderService;

    public ReportsController(IOrderService orderService)
    {
        _orderService = orderService;
    }

    [HttpGet("cancelled-orders")]
    public async Task<ActionResult<List<OrderDto>>> GetCancelledOrders(CancellationToken cancellationToken)
    {
        var orders = await _orderService.GetCancelledOrdersAsync(cancellationToken);
        return Ok(orders);
    }

    [HttpGet("unpaid-orders")]
    public async Task<ActionResult<List<OrderDto>>> GetUnpaidOrders(CancellationToken cancellationToken)
    {
        var orders = await _orderService.GetUnpaidOrdersAsync(cancellationToken);
        return Ok(orders);
    }
}
