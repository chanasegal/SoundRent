using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Services;

namespace SoundRent.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/reference-numbers")]
public class ReferenceNumbersController : ControllerBase
{
    private readonly IReferenceNumberService _referenceNumbers;

    public ReferenceNumbersController(IReferenceNumberService referenceNumbers)
    {
        _referenceNumbers = referenceNumbers;
    }

    /// <summary>Preview of the next order / loan number. Kinds: order, tool-loan, book-loan.</summary>
    [HttpGet("next/{kind}")]
    public async Task<ActionResult<int>> GetNext(string kind, CancellationToken cancellationToken)
    {
        try
        {
            return Ok(await _referenceNumbers.GetNextAsync(kind, cancellationToken));
        }
        catch (ValidationException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }
}
