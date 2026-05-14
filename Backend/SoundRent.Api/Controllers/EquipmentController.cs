using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Services;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class EquipmentController : ControllerBase
{
    private readonly IEquipmentService _equipmentService;

    public EquipmentController(IEquipmentService equipmentService)
    {
        _equipmentService = equipmentService;
    }

    [HttpGet]
    public async Task<ActionResult<List<EquipmentDto>>> GetAll(CancellationToken cancellationToken)
    {
        var rows = await _equipmentService.GetAllAsync(cancellationToken);
        return Ok(rows);
    }

    [HttpPatch("{equipmentType}/maintenance")]
    public async Task<ActionResult<EquipmentDto>> SetMaintenanceMode(
        EquipmentType equipmentType,
        [FromBody] EquipmentMaintenanceUpdateDto dto,
        CancellationToken cancellationToken)
    {
        var updated = await _equipmentService.SetMaintenanceModeAsync(
            equipmentType,
            dto.IsMaintenanceMode,
            cancellationToken);

        return Ok(updated);
    }
}
