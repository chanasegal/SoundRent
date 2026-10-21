namespace SoundRent.Api.Application.DTOs;

/// <summary>
/// Toggles the returned flag for the cash deposit tied to one order / tool loan / book loan.
/// Exactly one of <see cref="OrderId"/>, <see cref="ToolLoanId"/>, <see cref="BookLoanId"/> must be set.
/// </summary>
public class SetDepositReturnedDto
{
    public int? OrderId { get; set; }
    public int? ToolLoanId { get; set; }
    public int? BookLoanId { get; set; }
    public bool Returned { get; set; }
}
