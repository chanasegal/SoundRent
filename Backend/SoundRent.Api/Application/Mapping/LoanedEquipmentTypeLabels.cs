using System.ComponentModel;
using System.Reflection;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.Mapping;

public static class LoanedEquipmentTypeLabels
{
    public static string GetLabel(LoanedEquipmentType type)
    {
        var member = typeof(LoanedEquipmentType).GetMember(type.ToString()).FirstOrDefault();
        var description = member?.GetCustomAttribute<DescriptionAttribute>()?.Description;
        return string.IsNullOrWhiteSpace(description) ? type.ToString() : description;
    }
}
