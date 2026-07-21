using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Services;
using SoundRent.Api.Domain.Enums;

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

    /// <summary>
    /// Search by digits in phone fields or by name.
    /// Pass <paramref name="systemType"/> to limit to customers linked to that system.
    /// Omit it (or set <paramref name="global"/>) for cross-context autocomplete over the unified directory.
    /// Pass <paramref name="suggest"/> for a lean autocomplete projection (max 10, no Notes/systems).
    /// </summary>
    [HttpGet("search")]
    public async Task<ActionResult> Search(
        [FromQuery] string? q,
        [FromQuery] SystemType? systemType,
        [FromQuery] bool global = false,
        [FromQuery] bool suggest = false,
        CancellationToken cancellationToken = default)
    {
        var filter = global ? null : systemType;
        if (suggest)
        {
            var lean = await _customerService.SearchSuggestAsync(q, filter, cancellationToken);
            return Ok(lean);
        }

        var list = await _customerService.SearchAsync(q, filter, cancellationToken);
        return Ok(list);
    }

    /// <summary>
    /// Customers for the active system when <paramref name="systemType"/> is provided;
    /// otherwise same as search.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<List<CustomerDto>>> List(
        [FromQuery] string? q,
        [FromQuery] SystemType? systemType,
        [FromQuery] bool global = false,
        CancellationToken cancellationToken = default)
    {
        SystemType? filter = global ? null : (systemType ?? SystemType.Tools);
        var list = await _customerService.SearchAsync(q, filter, cancellationToken);
        return Ok(list);
    }

    [HttpGet("export")]
    public async Task<FileResult> Export(
        [FromQuery] SystemType? systemType,
        CancellationToken cancellationToken)
    {
        var export = await _customerService.ExportToExcelAsync(
            systemType ?? SystemType.Tools,
            cancellationToken);
        return File(export.Content, ICustomerService.ExcelContentType, export.FileName);
    }

    [HttpPost]
    public async Task<ActionResult<CustomerDto>> Upsert(
        [FromBody] CustomerUpsertDto dto,
        CancellationToken cancellationToken)
    {
        dto.SystemType ??= SystemType.Tools;
        var saved = await _customerService.UpsertAsync(dto, cancellationToken);
        return Ok(saved);
    }

    [HttpPut("{phone}")]
    public async Task<ActionResult<CustomerDto>> Update(
        string phone,
        [FromBody] CustomerUpsertDto dto,
        CancellationToken cancellationToken)
    {
        var saved = await _customerService.UpdateAsync(phone, dto, cancellationToken);
        return Ok(saved);
    }

    [HttpGet("{phone}/orders")]
    public async Task<ActionResult<List<OrderDto>>> Orders(string phone, CancellationToken cancellationToken)
    {
        var list = await _customerService.GetOrdersByPhone1Async(phone, cancellationToken);
        return Ok(list);
    }

    [HttpDelete("{phone}")]
    public async Task<IActionResult> Delete(string phone, CancellationToken cancellationToken)
    {
        await _customerService.DeleteAsync(phone, cancellationToken);
        return NoContent();
    }
}
