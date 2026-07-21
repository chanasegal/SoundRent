using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Services;

namespace SoundRent.Api.Controllers;

/// <summary>
/// Standalone inventory catalog (warehouse / quantity matrix).
/// Does not create weekly-board columns — those use EquipmentDefinitions.
/// </summary>
[ApiController]
[Authorize]
[Route("api/inventory-definitions")]
public class InventoryDefinitionsController : ControllerBase
{
    private readonly IInventoryDefinitionService _service;

    public InventoryDefinitionsController(IInventoryDefinitionService service)
    {
        _service = service;
    }

    [HttpGet]
    public async Task<ActionResult<List<InventoryDefinitionDto>>> GetAll(CancellationToken cancellationToken)
    {
        return Ok(await _service.GetAllAsync(cancellationToken));
    }

    [HttpPost]
    public async Task<ActionResult<InventoryDefinitionDto>> Create(
        [FromBody] InventoryDefinitionCreateDto dto,
        CancellationToken cancellationToken)
    {
        var created = await _service.CreateAsync(dto, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, created);
    }

    /// <summary>Find or create a catalog row by display name (used for free-text accessory lending).</summary>
    [HttpPost("ensure")]
    public async Task<ActionResult<InventoryDefinitionDto>> Ensure(
        [FromBody] InventoryDefinitionEnsureDto dto,
        CancellationToken cancellationToken)
    {
        try
        {
            var ensured = await _service.EnsureByDisplayNameAsync(dto.DisplayName, cancellationToken);
            return Ok(ensured);
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<InventoryDefinitionDto>> Update(
        int id,
        [FromBody] InventoryDefinitionUpdateDto dto,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.UpdateAsync(id, dto, cancellationToken));
    }

    [HttpPut("{id:int}/serials")]
    public async Task<ActionResult<InventoryDefinitionDto>> ReplaceSerials(
        int id,
        [FromBody] InventoryDefinitionSerialsUpdateDto dto,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.ReplaceSerialsAsync(id, dto, cancellationToken));
    }

    [HttpPut("batch")]
    public async Task<ActionResult<List<InventoryDefinitionDto>>> ReplaceSerialsBatch(
        [FromBody] InventoryDefinitionBatchUpdateDto dto,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.ReplaceSerialsBatchAsync(dto, cancellationToken));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        await _service.DeleteAsync(id, cancellationToken);
        return NoContent();
    }
}
