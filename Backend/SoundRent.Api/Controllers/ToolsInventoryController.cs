using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Services;

namespace SoundRent.Api.Controllers;

/// <summary>Tools-workspace inventory (isolated from Sound accessory inventory).</summary>
[ApiController]
[Authorize]
[Route("api/tools-inventory")]
public class ToolsInventoryController : ControllerBase
{
    private readonly IToolInventoryService _service;

    public ToolsInventoryController(IToolInventoryService service)
    {
        _service = service;
    }

    [HttpGet]
    public async Task<ActionResult<List<ToolDefinitionDto>>> GetAll(CancellationToken cancellationToken)
    {
        return Ok(await _service.GetAllAsync(cancellationToken));
    }

    [HttpPost]
    public async Task<ActionResult<ToolDefinitionDto>> Create(
        [FromBody] ToolDefinitionCreateDto dto,
        CancellationToken cancellationToken)
    {
        var created = await _service.CreateAsync(dto, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, created);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<ToolDefinitionDto>> Update(
        int id,
        [FromBody] ToolDefinitionUpdateDto dto,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.UpdateAsync(id, dto, cancellationToken));
    }

    [HttpPut("{id:int}/serials")]
    public async Task<ActionResult<ToolDefinitionDto>> ReplaceSerials(
        int id,
        [FromBody] ToolDefinitionSerialsUpdateDto dto,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.ReplaceSerialsAsync(id, dto, cancellationToken));
    }

    [HttpPut("batch")]
    public async Task<ActionResult<List<ToolDefinitionDto>>> ReplaceSerialsBatch(
        [FromBody] ToolDefinitionBatchUpdateDto dto,
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

    [HttpGet("location")]
    public async Task<ActionResult<ToolSerialLocationDto>> Locate(
        [FromQuery] string serialCode,
        [FromQuery] int? toolDefinitionId,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.LocateSerialAsync(serialCode, toolDefinitionId, cancellationToken));
    }

    [HttpGet("available-serials")]
    public async Task<ActionResult<List<string>>> AvailableSerials(
        [FromQuery] int[] toolIds,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.GetAvailableSerialsAsync(toolIds ?? [], cancellationToken));
    }
}
