using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Services;

namespace SoundRent.Api.Controllers;

/// <summary>Tools-workspace lending / returns (isolated from Sound orders).</summary>
[ApiController]
[Authorize]
[Route("api/tools-loans")]
public class ToolsLoansController : ControllerBase
{
    private readonly IToolLoanService _service;

    public ToolsLoansController(IToolLoanService service)
    {
        _service = service;
    }

    [HttpGet]
    public async Task<ActionResult<List<ToolLoanDto>>> GetAll(
        [FromQuery] bool? returned,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.GetAllAsync(returned, cancellationToken));
    }

    [HttpGet("active")]
    public async Task<ActionResult<List<ToolLoanDto>>> GetActive(CancellationToken cancellationToken)
    {
        return Ok(await _service.GetActiveAsync(cancellationToken));
    }

    [HttpPost]
    public async Task<ActionResult<ToolLoanDto>> Create(
        [FromBody] ToolLoanCreateDto dto,
        CancellationToken cancellationToken)
    {
        var created = await _service.CreateAsync(dto, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, created);
    }

    [HttpPost("{id:int}/return")]
    public async Task<ActionResult<ToolLoanDto>> MarkReturned(
        int id,
        [FromBody] ToolLoanReturnDto dto,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.MarkReturnedAsync(id, dto, cancellationToken));
    }

    [HttpPost("{loanId:int}/items/{itemId:int}/return")]
    public async Task<ActionResult<ToolLoanDto>> MarkItemReturned(
        int loanId,
        int itemId,
        [FromBody] ToolLoanReturnDto dto,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.MarkItemReturnedAsync(loanId, itemId, dto, cancellationToken));
    }
}
