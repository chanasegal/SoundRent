using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Services;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/equipment-default-accessories")]
public class EquipmentDefaultAccessoriesController : ControllerBase
{
    private readonly IEquipmentDefaultAccessoryService _service;

    public EquipmentDefaultAccessoriesController(IEquipmentDefaultAccessoryService service)
    {
        _service = service;
    }

    /// <summary>Default accessories bound to a specific parent unit (e.g. Mixer #10).</summary>
    [HttpGet]
    public async Task<ActionResult<List<EquipmentDefaultAccessoryDto>>> GetByParentUnit(
        [FromQuery] LoanedEquipmentType parentEquipmentType,
        [FromQuery] string parentSerialCode,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.GetByParentUnitAsync(
            parentEquipmentType,
            parentSerialCode,
            cancellationToken));
    }

    /// <summary>Counts of default accessories per parent unit (for admin badges).</summary>
    [HttpGet("counts")]
    public async Task<ActionResult<List<EquipmentDefaultAccessoryCountDto>>> GetCounts(
        [FromQuery] LoanedEquipmentType? parentEquipmentType,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.GetCountsByParentUnitAsync(parentEquipmentType, cancellationToken));
    }

    [HttpPost]
    public async Task<ActionResult<EquipmentDefaultAccessoryDto>> Create(
        [FromBody] CreateEquipmentDefaultAccessoryDto dto,
        CancellationToken cancellationToken)
    {
        var created = await _service.CreateAsync(dto, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, created);
    }

    [HttpPost("batch")]
    public async Task<ActionResult<List<EquipmentDefaultAccessoryDto>>> CreateBatch(
        [FromBody] CreateEquipmentDefaultAccessoriesBatchDto dto,
        CancellationToken cancellationToken)
    {
        var created = await _service.CreateBatchAsync(dto, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, created);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        await _service.DeleteAsync(id, cancellationToken);
        return NoContent();
    }
}
