using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Services;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/cash-deposits")]
public class CashDepositsController : ControllerBase
{
    private readonly ICashDepositService _cashDeposits;

    public CashDepositsController(ICashDepositService cashDeposits)
    {
        _cashDeposits = cashDeposits;
    }

    /// <summary>Cash deposits across all workspaces. Omit <paramref name="status"/> for every status.</summary>
    [HttpGet]
    public async Task<ActionResult<List<CashDepositDto>>> Get(
        [FromQuery] CashDepositStatus? status,
        [FromQuery] string? phone,
        CancellationToken cancellationToken)
    {
        return Ok(await _cashDeposits.GetAsync(status, phone, cancellationToken));
    }

    [HttpPost("{id:int}/mark-returned")]
    public async Task<ActionResult<CashDepositDto>> MarkReturned(int id, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _cashDeposits.MarkReturnedAsync(id, cancellationToken));
        }
        catch (NotFoundException)
        {
            return NotFound();
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}
