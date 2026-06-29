using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

public class Order
{
    public int Id { get; set; }

    [MaxLength(100)]
    public string? CustomerName { get; set; }

    [Required]
    [MaxLength(20)]
    public string Phone { get; set; } = string.Empty;

    [MaxLength(20)]
    public string? Phone2 { get; set; }

    [MaxLength(200)]
    public string? Address { get; set; }

    public DepositType? DepositType { get; set; }

    [MaxLength(100)]
    public string? DepositOnName { get; set; }

    public decimal? PaymentAmount { get; set; }

    public bool IsPaid { get; set; } = true;

    public bool IsCancelled { get; set; }

    public ReturnTimeType ReturnTimeType { get; set; } = ReturnTimeType.LateNight;

    [MaxLength(20)]
    public string? CustomReturnTime { get; set; }

    [MaxLength(1000)]
    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<OrderEquipment> Equipments { get; set; } = new List<OrderEquipment>();

    public ICollection<OrderShift> Shifts { get; set; } = new List<OrderShift>();

    public ICollection<OrderLoanedEquipment> LoanedEquipments { get; set; } = new List<OrderLoanedEquipment>();
}
