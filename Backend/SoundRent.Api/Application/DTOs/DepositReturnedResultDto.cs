namespace SoundRent.Api.Application.DTOs;

public class DepositReturnedResultDto
{
    public bool DepositReturned { get; set; }
    public CashDepositDto? Deposit { get; set; }
}
