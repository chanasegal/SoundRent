using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain;

/// <summary>
/// Maps dynamic booking slot ids (same as <see cref="Entities.EquipmentDefinition.Id"/>) to coarse
/// <see cref="EquipmentType"/> for maintenance mode. Slot validity is enforced via <c>EquipmentDefinitions</c> table.
/// </summary>
public static class BookingEquipmentSlots
{
    /// <summary>
    /// Maps a booking slot id to the coarse <see cref="EquipmentType"/> used for maintenance mode.
    /// </summary>
    public static bool TryGetMaintenanceEquipmentType(string slot, out EquipmentType equipmentType)
    {
        equipmentType = default;
        if (string.IsNullOrWhiteSpace(slot))
        {
            return false;
        }

        var s = slot.Trim();
        if (s.StartsWith("712-", StringComparison.Ordinal))
        {
            equipmentType = EquipmentType.Speaker712;
            return true;
        }

        if (s.StartsWith("315-", StringComparison.Ordinal))
        {
            equipmentType = EquipmentType.Speaker315;
            return true;
        }

        if (s.StartsWith("310-", StringComparison.Ordinal))
        {
            equipmentType = EquipmentType.Speaker310;
            return true;
        }

        if (s.StartsWith("710-", StringComparison.Ordinal))
        {
            equipmentType = EquipmentType.Speaker710;
            return true;
        }

        if (s.StartsWith("715-", StringComparison.Ordinal))
        {
            equipmentType = EquipmentType.Speaker715;
            return true;
        }

        if (s.StartsWith("912-", StringComparison.Ordinal))
        {
            equipmentType = EquipmentType.Speaker912;
            return true;
        }

        if (s.StartsWith("910NX-", StringComparison.Ordinal))
        {
            equipmentType = EquipmentType.NX910;
            return true;
        }

        if (s.StartsWith("910ART-", StringComparison.Ordinal))
        {
            equipmentType = EquipmentType.ART910;
            return true;
        }

        return false;
    }
}
