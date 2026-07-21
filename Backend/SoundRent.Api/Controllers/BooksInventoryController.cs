using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Services;

namespace SoundRent.Api.Controllers;

/// <summary>Library-workspace inventory (isolated from Sound accessory inventory).</summary>
[ApiController]
[Authorize]
[Route("api/books-inventory")]
public class BooksInventoryController : ControllerBase
{
    private readonly IBookInventoryService _service;

    public BooksInventoryController(IBookInventoryService service)
    {
        _service = service;
    }

    [HttpGet]
    public async Task<ActionResult<List<BookDto>>> GetAll(CancellationToken cancellationToken)
    {
        return Ok(await _service.GetAllAsync(cancellationToken));
    }

    [HttpPost]
    public async Task<ActionResult<BookDto>> Create(
        [FromBody] BookCreateDto dto,
        CancellationToken cancellationToken)
    {
        var created = await _service.CreateAsync(dto, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, created);
    }

    /// <summary>Bulk-import books from an Excel (.xlsx) or CSV file.</summary>
    [HttpPost("import")]
    [RequestSizeLimit(20_000_000)]
    public async Task<ActionResult<BookImportResultDto>> Import(
        IFormFile file,
        CancellationToken cancellationToken)
    {
        var result = await _service.ImportFromFileAsync(file, cancellationToken);
        return Ok(result);
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<BookDto>> Update(
        int id,
        [FromBody] BookUpdateDto dto,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.UpdateAsync(id, dto, cancellationToken));
    }

    [HttpPut("{id:int}/copies")]
    public async Task<ActionResult<BookDto>> ReplaceSerials(
        int id,
        [FromBody] BookCopiesUpdateDto dto,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.ReplaceSerialsAsync(id, dto, cancellationToken));
    }

    [HttpPut("batch")]
    public async Task<ActionResult<List<BookDto>>> ReplaceSerialsBatch(
        [FromBody] BookBatchUpdateDto dto,
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
    public async Task<ActionResult<BookCopyLocationDto>> Locate(
        [FromQuery] string copyNumber,
        [FromQuery] int? bookId,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.LocateSerialAsync(copyNumber, bookId, cancellationToken));
    }

    [HttpGet("available-copies")]
    public async Task<ActionResult<List<string>>> AvailableCopies(
        [FromQuery] int[] bookIds,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.GetAvailableSerialsAsync(bookIds ?? [], cancellationToken));
    }

    /// <summary>
    /// Bulk availability for all tools in one request (avoids N+1 / pool exhaustion).
    /// </summary>
    [HttpGet("available-copies/all")]
    public async Task<ActionResult<List<BookAvailableCopiesGroupDto>>> AvailableSerialsAll(
        CancellationToken cancellationToken)
    {
        return Ok(await _service.GetAllAvailableSerialsGroupedAsync(cancellationToken));
    }
}
