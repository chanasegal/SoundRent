using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Services;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class InstitutionsController : ControllerBase
{
    private readonly IInstitutionService _institutions;

    public InstitutionsController(IInstitutionService institutions)
    {
        _institutions = institutions;
    }

    /// <summary>
    /// Search by institution name.
    /// Pass <paramref name="systemType"/> to limit to institutions linked to that system.
    /// Omit it (or set <paramref name="global"/>) for the unified directory.
    /// </summary>
    [HttpGet("search")]
    public async Task<ActionResult<List<InstitutionDto>>> Search(
        [FromQuery] string? query,
        [FromQuery] string? q,
        [FromQuery] SystemType? systemType,
        [FromQuery] bool global = false,
        CancellationToken cancellationToken = default)
    {
        var term = query ?? q;
        var filter = global ? null : systemType;
        var list = await _institutions.SearchAsync(term, filter, cancellationToken);
        return Ok(list);
    }

    /// <summary>
    /// Institutions for the active system when <paramref name="systemType"/> is provided;
    /// otherwise same as search.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<List<InstitutionDto>>> List(
        [FromQuery] string? query,
        [FromQuery] string? q,
        [FromQuery] SystemType? systemType,
        [FromQuery] bool global = false,
        CancellationToken cancellationToken = default)
    {
        var term = query ?? q;
        SystemType? filter = global ? null : (systemType ?? SystemType.Tools);
        var list = await _institutions.SearchAsync(term, filter, cancellationToken);
        return Ok(list);
    }

    [HttpGet("export-excel")]
    public async Task<FileResult> ExportExcel(
        [FromQuery] SystemType? systemType,
        CancellationToken cancellationToken)
    {
        var export = await _institutions.ExportToExcelAsync(
            systemType ?? SystemType.Tools,
            cancellationToken);
        return File(export.Content, IInstitutionService.ExcelContentType, export.FileName);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<InstitutionDto>> GetById(int id, CancellationToken cancellationToken)
    {
        var entity = await _institutions.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("המוסד לא נמצא");
        return Ok(entity);
    }

    [HttpGet("{id:int}/orders")]
    public async Task<ActionResult<List<OrderDto>>> Orders(int id, CancellationToken cancellationToken)
    {
        var list = await _institutions.GetOrdersAsync(id, cancellationToken);
        return Ok(list);
    }

    [HttpPost]
    public async Task<ActionResult<InstitutionDto>> Create(
        [FromBody] InstitutionCreateUpdateDto dto,
        CancellationToken cancellationToken)
    {
        try
        {
            dto.SystemType ??= SystemType.Tools;
            var created = await _institutions.CreateAsync(dto, cancellationToken);
            return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<InstitutionDto>> Update(
        int id,
        [FromBody] InstitutionCreateUpdateDto dto,
        CancellationToken cancellationToken)
    {
        try
        {
            dto.SystemType ??= SystemType.Tools;
            var updated = await _institutions.UpdateAsync(id, dto, cancellationToken);
            return Ok(updated);
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        try
        {
            await _institutions.DeleteAsync(id, cancellationToken);
            return NoContent();
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}
