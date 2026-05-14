using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class LoanedEquipmentNoteDefaultsController : ControllerBase
{
    private readonly ILoanedEquipmentTypeNoteDefaultRepository _repository;

    public LoanedEquipmentNoteDefaultsController(ILoanedEquipmentTypeNoteDefaultRepository repository)
    {
        _repository = repository;
    }

    [HttpGet]
    [AllowAnonymous]
    public async Task<ActionResult<List<LoanedEquipmentTypeNoteDefaultDto>>> GetAll(CancellationToken cancellationToken)
    {
        var rows = await _repository.GetAllAsync(cancellationToken);
        var dto = rows
            .Select(r => new LoanedEquipmentTypeNoteDefaultDto
            {
                LoanedEquipmentType = r.LoanedEquipmentType,
                DefaultNoteCount = r.DefaultNoteCount
            })
            .ToList();
        return Ok(dto);
    }

    [HttpPut("{type}")]
    [Authorize]
    public async Task<ActionResult<LoanedEquipmentTypeNoteDefaultDto>> Update(
        LoanedEquipmentType type,
        [FromBody] LoanedEquipmentTypeNoteDefaultUpdateDto dto,
        CancellationToken cancellationToken)
    {
        var entity = await _repository.GetAsync(type, cancellationToken)
            ?? throw new NotFoundException("הגדרה לא נמצאה");

        entity.DefaultNoteCount = Math.Clamp(dto.DefaultNoteCount, 0, 20);
        await _repository.SaveChangesAsync(cancellationToken);

        return Ok(new LoanedEquipmentTypeNoteDefaultDto
        {
            LoanedEquipmentType = entity.LoanedEquipmentType,
            DefaultNoteCount = entity.DefaultNoteCount
        });
    }
}
