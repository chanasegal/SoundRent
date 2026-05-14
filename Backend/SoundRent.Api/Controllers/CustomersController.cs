using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Services;

namespace SoundRent.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class CustomersController : ControllerBase
{
    private readonly ICustomerService _customerService;

    public CustomersController(ICustomerService customerService)
    {
        _customerService = customerService;
    }

    /// <summary>Search by digits in phone fields or by name (fuzzy on phones via digit substring).</summary>
    [HttpGet("search")]
    public async Task<ActionResult<List<CustomerDto>>> Search([FromQuery] string? q, CancellationToken cancellationToken)
    {
        var list = await _customerService.SearchAsync(q, cancellationToken);
        return Ok(list);
    }

    /// <summary>All customers when <paramref name="q"/> is empty (capped); same search when provided.</summary>
    [HttpGet]
    public Task<ActionResult<List<CustomerDto>>> List([FromQuery] string? q, CancellationToken cancellationToken)
    {
        return Search(q, cancellationToken);
    }

    [HttpPost]
    public async Task<ActionResult<CustomerDto>> Upsert([FromBody] CustomerUpsertDto dto, CancellationToken cancellationToken)
    {
        var saved = await _customerService.UpsertAsync(dto, cancellationToken);
        return Ok(saved);
    }

    [HttpGet("{phone}/orders")]
    public async Task<ActionResult<List<OrderDto>>> Orders(string phone, CancellationToken cancellationToken)
    {
        var list = await _customerService.GetOrdersByPhone1Async(phone, cancellationToken);
        return Ok(list);
    }
}
