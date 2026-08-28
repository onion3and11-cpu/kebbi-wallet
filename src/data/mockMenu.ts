export interface MenuItem {
  id: string;
  name: string;
  category: string;
  price: number;
  image: string;
  description: string;
}

export const MOCK_MENU: MenuItem[] = [
  {
    id: 'm1',
    name: '經典雙層起司牛肉堡',
    category: '漢堡',
    price: 220,
    image: '🍔',
    description: '100% 純牛肉雙層肉排、濃郁起司與特調美式醬汁',
  },
  {
    id: 'm2',
    name: '美式秘製炸雞堡',
    category: '漢堡',
    price: 180,
    image: '🥪',
    description: '酥脆多汁去骨雞腿肉搭配新鮮生菜與美乃滋',
  },
  {
    id: 'm3',
    name: '特級波霸珍珠奶茶',
    category: '飲料',
    price: 80,
    image: '🧋',
    description: '現煮 Q 彈黑糖珍珠與濃厚鮮奶茶黃金比例',
  },
  {
    id: 'm4',
    name: '冷萃黑咖啡',
    category: '飲料',
    price: 90,
    image: '☕',
    description: '低溫慢速萃取，口感順口不苦澀帶有堅果香氣',
  },
  {
    id: 'm5',
    name: '黃金松露薯條 (大)',
    category: '附餐',
    price: 110,
    image: '🍟',
    description: '金黃酥脆現炸薯條搭配特級白松露沾醬',
  },
  {
    id: 'm6',
    name: '凱薩雞肉沙拉',
    category: '附餐',
    price: 140,
    image: '🥗',
    description: '嫩煎雞胸肉、帕馬森起司與香酥麵包丁',
  },
];
