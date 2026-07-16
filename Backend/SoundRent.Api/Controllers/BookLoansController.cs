using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Services;

namespace SoundRent.Api.Controllers;

/// <summary>Library-workspace lending / returns (isolated from Sound orders).</summary>
[ApiController]
[Authorize]
[Route("api/book-loans")]
public class BookLoansController : ControllerBase
{
    private readonly IBookLoanService _service;

    public BookLoansController(IBookLoanService service)
    {
        _service = service;
    }

    [HttpGet]
    public async Task<ActionResult<List<BookLoanDto>>> GetAll(
        [FromQuery] bool? returned,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.GetAllAsync(returned, cancellationToken));
    }

    [HttpGet("active")]
    public async Task<ActionResult<List<BookLoanDto>>> GetActive(CancellationToken cancellationToken)
    {
        return Ok(await _service.GetActiveAsync(cancellationToken));
    }

    [HttpGet("customer/{phone}")]
    public async Task<ActionResult<List<BookLoanDto>>> GetByCustomerPhone(
        string phone,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.GetByCustomerPhoneAsync(phone, cancellationToken));
    }

    [HttpPost("{id:int}/renew")]
    public async Task<ActionResult<BookLoanDto>> Renew(int id, CancellationToken cancellationToken)
    {
        return Ok(await _service.RenewAsync(id, cancellationToken));
    }

    [HttpPost]
    public async Task<ActionResult<BookLoanDto>> Create(
        [FromBody] BookLoanCreateDto dto,
        CancellationToken cancellationToken)
    {
        var created = await _service.CreateAsync(dto, cancellationToken);
        return StatusCode(StatusCodes.Status201Created, created);
    }

    [HttpPost("{id:int}/return")]
    public async Task<ActionResult<BookLoanDto>> MarkReturned(
        int id,
        [FromBody] BookLoanReturnDto dto,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.MarkReturnedAsync(id, dto, cancellationToken));
    }

    [HttpPost("{loanId:int}/items/{itemId:int}/return")]
    public async Task<ActionResult<BookLoanDto>> MarkItemReturned(
        int loanId,
        int itemId,
        [FromBody] BookLoanReturnDto dto,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.MarkItemReturnedAsync(loanId, itemId, dto, cancellationToken));
    }

    /// <summary>
    /// Undo a returned item: clear return stamp, delete linked debt, restore to active lending.
    /// </summary>
    [HttpPost("{loanId:int}/items/{itemId:int}/undo-return")]
    public async Task<ActionResult<BookLoanDto>> UndoItemReturn(
        int loanId,
        int itemId,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.UndoItemReturnAsync(loanId, itemId, cancellationToken));
    }

    /// <summary>
    /// Alias matching “undo by loan”: requires itemId in body so the correct returned unit is restored.
    /// </summary>
    [HttpPost("{id:int}/undo-return")]
    public async Task<ActionResult<BookLoanDto>> UndoReturn(
        int id,
        [FromBody] BookLoanUndoReturnDto dto,
        CancellationToken cancellationToken)
    {
        if (dto.ItemId <= 0)
        {
            return BadRequest(new { statusCode = 400, message = "יש לציין מזהה פריט (itemId) לביטול החזרה" });
        }

        return Ok(await _service.UndoItemReturnAsync(id, dto.ItemId, cancellationToken));
    }

    /// <summary>Permanently delete a tool loan and any associated debts.</summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken cancellationToken)
    {
        await _service.DeleteAsync(id, cancellationToken);
        return NoContent();
    }

    /// <summary>Quick return: find active loan item by tool type + serial and mark returned.</summary>
    [HttpPost("return-by-code")]
    public async Task<ActionResult<BookLoanDto>> ReturnByCode(
        [FromBody] BookLoanReturnByCodeDto dto,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.ReturnByCodeAsync(dto, cancellationToken));
    }

    /// <summary>Audit history of completed returns for one tool definition + serial (ReturnedAt DESC).</summary>
    [HttpGet("item-history")]
    public async Task<ActionResult<List<BookItemBorrowHistoryDto>>> ItemHistory(
        [FromQuery] int bookId,
        [FromQuery] string copyNumber,
        CancellationToken cancellationToken)
    {
        return Ok(await _service.GetItemBorrowHistoryAsync(bookId, copyNumber, cancellationToken));
    }
}
