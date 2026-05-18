namespace SoundRent.Api.Domain.Entities;

/// <summary>
/// Join row between an order and a weekly-grid equipment column.
/// </summary>
public class OrderEquipment
{
    public int OrderId { get; set; }
    public Order Order { get; set; } = null!;

    public string EquipmentDefinitionId { get; set; } = string.Empty;
    public EquipmentDefinition EquipmentDefinition { get; set; } = null!;
}
