using System.ComponentModel;

namespace SoundRent.Api.Domain.Enums;

public enum LoanedEquipmentType
{
    [Description("מיקסר")]
    Mixer = 1,

    [Description("תיק")]
    Bag = 2,

    [Description("כבל חשמל")]
    PowerCable = 3,

    [Description("נרתיק למיקרופון")]
    MicrophonePouch = 4,

    [Description("מיקרופון")]
    Microphone = 5,

    [Description("XLR")]
    Xlr = 6,

    [Description("מחברים")]
    Connectors = 7,

    [Description("משדר בלוטוס")]
    BluetoothTransmitter = 8,

    [Description("כבל נגן")]
    AuxCable = 9,

    [Description("כבל אורגן")]
    KeyboardCable = 10,

    [Description("כבל RCA")]
    RcaCable = 11,

    [Description("סטנד בוקסה")]
    SpeakerStand = 12,

    [Description("סטנד מיקרופון")]
    MicrophoneStand = 13,

    [Description("כבל מאריך")]
    ExtensionCable = 14,

    [Description("כבל מפצל")]
    SplitterCable = 15,

    [Description("מפצל")]
    PowerSplitter = 16
}
