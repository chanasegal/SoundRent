using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Services;

namespace SoundRent.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/lost-equipment")]
public class LostEquipmentController : ControllerBase
{
    private readonly ILostEquipmentService _lostEquipmentService;

    public LostEquipmentController(ILostEquipmentService lostEquipmentService)
    {
        _lostEquipmentService = lostEquipmentService;
    }

    [HttpGet]
    public async Task<ActionResult<List<LostEquipmentDto>>> GetAll(CancellationToken cancellationToken)
    {
        var list = await _lostEquipmentService.GetAllAsync(cancellationToken);
        return Ok(list);
    }

    [HttpPost]
    public async Task<ActionResult<LostEquipmentDto>> Create(
        [FromBody] LostEquipmentCreateDto dto,
        CancellationToken cancellationToken)
    {
        var created = await _lostEquipmentService.CreateAsync(dto, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, created);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<LostEquipmentDto>> Update(
        int id,
        [FromBody] LostEquipmentUpdateDto dto,
        CancellationToken cancellationToken)
    {
        var updated = await _lostEquipmentService.UpdateAsync(id, dto, cancellationToken);
        return Ok(updated);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        await _lostEquipmentService.DeleteAsync(id, cancellationToken);
        return NoContent();
    }
}
