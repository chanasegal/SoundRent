using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Services;

namespace SoundRent.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/waitlist")]
public class WaitlistController : ControllerBase
{
    private readonly IWaitlistService _waitlistService;

    public WaitlistController(IWaitlistService waitlistService)
    {
        _waitlistService = waitlistService;
    }

    [HttpGet("weekly")]
    public async Task<ActionResult<List<WaitlistEntryDto>>> GetWeekly(
        [FromQuery] DateOnly startDate,
        CancellationToken cancellationToken)
    {
        var list = await _waitlistService.GetWeeklyAsync(startDate, cancellationToken);
        return Ok(list);
    }

    /// <summary>Full-database waitlist for Excel backup (same sort as repository: date, then created).</summary>
    [HttpGet("export-all")]
    public async Task<ActionResult<List<WaitlistEntryDto>>> ExportAll(CancellationToken cancellationToken)
    {
        var list = await _waitlistService.GetAllForExportAsync(cancellationToken);
        return Ok(list);
    }

    [HttpPost]
    public async Task<ActionResult<WaitlistEntryDto>> Create(
        [FromBody] WaitlistEntryCreateDto dto,
        CancellationToken cancellationToken)
    {
        var created = await _waitlistService.CreateAsync(dto, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, created);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        await _waitlistService.DeleteAsync(id, cancellationToken);
        return NoContent();
    }
}
