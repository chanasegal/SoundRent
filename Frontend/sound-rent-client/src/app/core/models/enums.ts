export enum EquipmentType {
  ART910 = 'ART910',
  NX910 = 'NX910',
  Speaker710 = 'Speaker710',
  Speaker712 = 'Speaker712',
  Speaker715 = 'Speaker715',
  Speaker912 = 'Speaker912',
  Speaker315 = 'Speaker315',
  Speaker310 = 'Speaker310'
}

export enum TimeSlot {
  Morning = 'Morning',
  Evening = 'Evening'
}

export enum DepositType {
  Check = 'Check',
  CreditCard = 'CreditCard',
  Cash = 'Cash'
}

export enum LoanedEquipmentType {
  Mixer = 'Mixer',
  Bag = 'Bag',
  PowerCable = 'PowerCable',
  MicrophonePouch = 'MicrophonePouch',
  Microphone = 'Microphone',
  Xlr = 'Xlr',
  Connectors = 'Connectors',
  BluetoothTransmitter = 'BluetoothTransmitter',
  AuxCable = 'AuxCable',
  KeyboardCable = 'KeyboardCable',
  RcaCable = 'RcaCable',
  SpeakerStand = 'SpeakerStand',
  MicrophoneStand = 'MicrophoneStand',
  ExtensionCable = 'ExtensionCable',
  SplitterCable = 'SplitterCable',
  PowerSplitter = 'PowerSplitter'
}

export const EQUIPMENT_TYPE_LABELS: Record<EquipmentType, string> = {
  [EquipmentType.ART910]: 'ART 910',
  [EquipmentType.NX910]: 'NX 910',
  [EquipmentType.Speaker710]: '710',
  [EquipmentType.Speaker712]: '712',
  [EquipmentType.Speaker715]: '715',
  [EquipmentType.Speaker912]: '912',
  [EquipmentType.Speaker315]: '315',
  [EquipmentType.Speaker310]: '310'
};

export const EQUIPMENT_TYPE_ORDER: EquipmentType[] = [
  EquipmentType.ART910,
  EquipmentType.NX910,
  EquipmentType.Speaker710,
  EquipmentType.Speaker712,
  EquipmentType.Speaker715,
  EquipmentType.Speaker912,
  EquipmentType.Speaker315,
  EquipmentType.Speaker310
];

export const TIME_SLOT_LABELS: Record<TimeSlot, string> = {
  [TimeSlot.Morning]: 'בוקר',
  [TimeSlot.Evening]: 'ערב'
};

export const DEPOSIT_TYPE_LABELS: Record<DepositType, string> = {
  [DepositType.Check]: 'צ׳ק',
  [DepositType.CreditCard]: 'כרטיס אשראי',
  [DepositType.Cash]: 'מזומן'
};

export const LOANED_EQUIPMENT_LABELS: Record<LoanedEquipmentType, string> = {
  [LoanedEquipmentType.Mixer]: 'מיקסר',
  [LoanedEquipmentType.Bag]: 'תיק',
  [LoanedEquipmentType.PowerCable]: 'כבל חשמל',
  [LoanedEquipmentType.MicrophonePouch]: 'נרתיק למיקרופון',
  [LoanedEquipmentType.Microphone]: 'מיקרופון',
  [LoanedEquipmentType.Xlr]: 'XLR',
  [LoanedEquipmentType.Connectors]: 'מחברים',
  [LoanedEquipmentType.BluetoothTransmitter]: 'משדר בלוטוס',
  [LoanedEquipmentType.AuxCable]: 'כבל נגן',
  [LoanedEquipmentType.KeyboardCable]: 'כבל אורגן',
  [LoanedEquipmentType.RcaCable]: 'כבל RCA',
  [LoanedEquipmentType.SpeakerStand]: 'סטנד בוקסה',
  [LoanedEquipmentType.MicrophoneStand]: 'סטנד מיקרופון',
  [LoanedEquipmentType.ExtensionCable]: 'כבל מאריך',
  [LoanedEquipmentType.SplitterCable]: 'כבל מפצל',
  [LoanedEquipmentType.PowerSplitter]: 'מפצל'
};

export const LOANED_EQUIPMENT_ORDER: LoanedEquipmentType[] = [
  LoanedEquipmentType.Mixer,
  LoanedEquipmentType.Bag,
  LoanedEquipmentType.PowerCable,
  LoanedEquipmentType.MicrophonePouch,
  LoanedEquipmentType.Microphone,
  LoanedEquipmentType.Xlr,
  LoanedEquipmentType.Connectors,
  LoanedEquipmentType.BluetoothTransmitter,
  LoanedEquipmentType.AuxCable,
  LoanedEquipmentType.KeyboardCable,
  LoanedEquipmentType.RcaCable,
  LoanedEquipmentType.SpeakerStand,
  LoanedEquipmentType.MicrophoneStand,
  LoanedEquipmentType.ExtensionCable,
  LoanedEquipmentType.SplitterCable,
  LoanedEquipmentType.PowerSplitter
];
