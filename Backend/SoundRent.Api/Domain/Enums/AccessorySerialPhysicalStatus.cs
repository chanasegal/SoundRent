namespace SoundRent.Api.Domain.Enums;

/// <summary>Global warehouse status for a physical accessory serial unit.</summary>
public enum AccessorySerialPhysicalStatus
{
    InWarehouse = 0,
    LoanedOut = 1,
    /// <summary>Marked missing / not returned (חסר / לא הוחזר).</summary>
    Missing = 2,
    /// <summary>Temporarily unavailable due to repair / maintenance.</summary>
    InRepair = 3
}
