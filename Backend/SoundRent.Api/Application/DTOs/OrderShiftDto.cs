using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class OrderShiftDto
{
    [Required(ErrorMessage = "יש להזין תאריך הזמנה")]
    public DateOnly OrderDate { get; set; }

    [Required(ErrorMessage = "יש לבחור משמרת")]
    public TimeSlot TimeSlot { get; set; }
}
