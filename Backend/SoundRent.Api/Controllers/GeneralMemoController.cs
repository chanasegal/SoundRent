using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Services;

namespace SoundRent.Api.Controllers;

[ApiController]
[Authorize]
[Route("api/memo")]
public class GeneralMemoController : ControllerBase
{
    private readonly IGeneralMemoService _memoService;

    public GeneralMemoController(IGeneralMemoService memoService)
    {
        _memoService = memoService;
    }

    [HttpGet]
    public async Task<ActionResult<GeneralMemoDto>> Get(CancellationToken cancellationToken)
    {
        var memo = await _memoService.GetAsync(cancellationToken);
        return Ok(memo);
    }

    [HttpPost]
    public async Task<ActionResult<GeneralMemoDto>> Save(
        [FromBody] GeneralMemoUpdateDto dto,
        CancellationToken cancellationToken)
    {
        var memo = await _memoService.SaveAsync(dto.Content, cancellationToken);
        return Ok(memo);
    }
}
