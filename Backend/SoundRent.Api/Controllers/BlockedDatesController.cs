using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Services;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/blocked-dates")]
public class BlockedDatesController : ControllerBase
{
    private readonly IBlockedDateService _blockedDateService;

    public BlockedDatesController(IBlockedDateService blockedDateService)
    {
        _blockedDateService = blockedDateService;
    }

    [HttpGet]
    public async Task<ActionResult<List<BlockedDateDto>>> GetAll(
        [FromQuery] DateOnly? startDate,
        [FromQuery] DateOnly? endDate,
        [FromQuery] SystemType? systemType,
        CancellationToken cancellationToken)
    {
        var list = await _blockedDateService.GetOverlappingAsync(
            startDate,
            endDate,
            systemType ?? SystemType.Tools,
            cancellationToken);
        return Ok(list);
    }

    [HttpPost]
    public async Task<ActionResult<BlockedDateDto>> Create(
        [FromBody] BlockedDateCreateDto dto,
        CancellationToken cancellationToken)
    {
        var created = await _blockedDateService.CreateAsync(dto, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, created);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<BlockedDateDto>> Update(
        int id,
        [FromBody] BlockedDateUpdateDto dto,
        CancellationToken cancellationToken)
    {
        var updated = await _blockedDateService.UpdateAsync(id, dto, cancellationToken);
        return Ok(updated);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        await _blockedDateService.DeleteAsync(id, cancellationToken);
        return NoContent();
    }
}
