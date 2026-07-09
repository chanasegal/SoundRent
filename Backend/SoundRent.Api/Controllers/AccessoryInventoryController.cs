using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Services;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/accessoryinventory")]
public class AccessoryInventoryController : ControllerBase
{
    private readonly IAccessorySerialInventoryService _service;

    public AccessoryInventoryController(IAccessorySerialInventoryService service)
    {
        _service = service;
    }

    [HttpGet]
    public async Task<ActionResult<List<AccessoryInventoryGroupDto>>> GetAll(CancellationToken cancellationToken)
    {
        var list = await _service.GetAllGroupedAsync(cancellationToken);
        return Ok(list);
    }

    [HttpPut("{equipmentType}")]
    public async Task<ActionResult<AccessoryInventoryGroupDto>> UpdateType(
        LoanedEquipmentType equipmentType,
        [FromBody] AccessoryInventoryUpdateDto dto,
        CancellationToken cancellationToken)
    {
        var updated = await _service.UpdateTypeAsync(equipmentType, dto, cancellationToken);
        return Ok(updated);
    }

    [HttpPut("batch")]
    public async Task<ActionResult<List<AccessoryInventoryGroupDto>>> UpdateBatch(
        [FromBody] AccessoryInventoryBatchUpdateDto dto,
        CancellationToken cancellationToken)
    {
        var updated = await _service.UpdateAllAsync(dto, cancellationToken);
        return Ok(updated);
    }

    [HttpPost("availability")]
    public async Task<ActionResult<List<AccessorySerialAvailabilityGroupDto>>> GetAvailability(
        [FromBody] AccessorySerialAvailabilityRequestDto request,
        CancellationToken cancellationToken)
    {
        var list = await _service.GetAvailabilityAsync(request, cancellationToken);
        return Ok(list);
    }

    [HttpGet("location")]
    public async Task<ActionResult<AccessorySerialLocationDto>> GetSerialCodeLocation(
        [FromQuery] LoanedEquipmentType equipmentType,
        [FromQuery] string serialCode,
        CancellationToken cancellationToken)
    {
        var location = await _service.GetSerialCodeLocationAsync(equipmentType, serialCode, cancellationToken);
        return Ok(location);
    }
}
