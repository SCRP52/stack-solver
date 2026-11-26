import { suits } from './stack-library.mjs';

export const beyondGroups = {
  recall: ['Recall', 'Recall'], split: ['Split', 'Split'], relations: ['Quan hệ màu và chất', 'Color & Suit Relations'],
  knowledge: ['Thông tin stack', 'Stack Knowledge'], poker: ['Poker Hand', 'Poker Hand'], straight: ['Sảnh cụ thể', 'Specific Straight'],
};

const sameSuit = ['cùng chất', 'of the same suit'];
const sameColor = ['cùng màu', 'of the same color'];
const oppositeColor = ['khác màu', 'of the opposite color'];
const differentSuit = ['cùng màu nhưng khác chất', 'of the same color in a different suit'];
const relation = (forward, [vi, en]) => [
  `Lá ${vi} ${forward ? 'tiếp theo' : 'phía trước'}`,
  `${forward ? 'Next' : 'Previous'} card ${en}`,
  `Đi ${forward ? 'xuôi' : 'ngược'} từ {0} theo vòng stack. Lá ${vi} gần nhất là lá nào?`,
  `Go ${forward ? 'forward' : 'backward'} from {0} around the stack. What is the first card ${en}?`,
];

export const beyondDrills = {
  earlier: ['Lá đứng trước', 'Earlier Card', 'Lá nào đứng trước trong stack?', 'Which card comes earlier in the stack?'],
  'first-card': ['Lá đầu nhóm', 'First Card', 'Lá nào có vị trí nhỏ nhất trong nhóm?', 'Which card has the lowest position in this group?'],
  'last-card': ['Lá cuối nhóm', 'Last Card', 'Lá nào có vị trí lớn nhất trong nhóm?', 'Which card has the highest position in this group?'],
  'recall-up': ['Xếp xuôi', 'Forward Recall', 'Xếp các lá theo thứ tự stack từ trên xuống.', 'Arrange these cards in stack order from top to bottom.'],
  'recall-down': ['Xếp ngược', 'Backward Recall', 'Xếp các lá theo thứ tự stack từ dưới lên.', 'Arrange these cards in stack order from bottom to top.'],
  'recall-progressive': ['Xếp tăng dần số lá', 'Progressive Recall', 'Xếp các lá theo thứ tự stack từ trên xuống.', 'Arrange these cards in stack order from top to bottom.'],
  'recall-full': ['Xếp cả bộ', 'Full Deck Recall', 'Xếp cả 52 lá theo thứ tự stack từ trên xuống.', 'Rebuild the 52-card stack from top to bottom.'],
  'split-one': ['Phân một lá', 'Split One', 'Lá này thuộc tụ nào?', 'Which pile contains this card?'],
  'split-group': ['Phân nhóm lá', 'Split a Group', 'Chọn tụ cho từng lá trong nhóm.', 'Choose a pile for each card in the group.'],
  'split-full': ['Phân cả bộ', 'Split Full Deck', 'Chọn tụ cho từng lá trong cả bộ.', 'Choose a pile for each card in the deck.'],
  'next-suit': relation(true, sameSuit),
  'previous-suit': relation(false, sameSuit),
  'next-color': relation(true, sameColor),
  'previous-color': relation(false, sameColor),
  'next-opposite': relation(true, oppositeColor),
  'previous-opposite': relation(false, oppositeColor),
  'next-color-suit': relation(true, differentSuit),
  'previous-color-suit': relation(false, differentSuit),
  'color-count': ['Đếm theo màu', 'Color Count'],
  'suit-count': ['Đếm theo chất', 'Suit Count'],
  'suit-distribution': ['Phân bố bốn chất', 'Suit Distribution'],
  'value-sum': ['Tổng giá trị', 'Value Sum'],
  'poker-hand': ['Tìm tay bài', 'Find a Poker Hand'],
  'specific-straight': ['Tìm sảnh chỉ định', 'Find a Specific Straight'],
};

export const handNames = { pair: 'One Pair', 'two-pair': 'Two Pair', three: 'Three of a Kind', straight: 'Straight', flush: 'Flush',
  'full-house': 'Full House', four: 'Four of a Kind', 'straight-flush': 'Straight Flush', royal: 'Royal Flush' };

export const beyondDetails = {
  recall: ['Nhận ra thứ tự gốc của những lá rải khắp stack. Có bài chọn lá đứng trước và bài xếp cả nhóm.', 'Recall the original order of scattered cards, from finding one card to sorting the whole group.'],
  split: ['Chia stack gốc thành các tụ liền nhau và chọn tụ của từng lá.', 'Divide the original stack into contiguous piles and classify each card.'],
  relations: ['Tìm lá gần nhất thỏa điều kiện màu và chất theo chiều của câu hỏi. Có vòng qua đầu hoặc đáy stack.', 'Find the nearest card matching the color or suit condition in the given direction, wrapping around the stack.'],
  knowledge: ['Đếm màu, chất hoặc tổng giá trị ở phía trên, phía dưới hoặc giữa các lá đã cho. A = 1, J = 11, Q = 12, K = 13.', 'Count colors, suits, or total ranks above, below or between the given cards. A = 1, J = 11, Q = 12, K = 13.'],
  poker: ['Biết lá đáy sau khi cắt rồi chọn vị trí tạo thành tay bài. Lá đáy dùng được ở ngoài vùng. Pair, Two Pair, Three và Four chỉ cần các lá cùng giá trị đủ để tạo cụm.', 'Use the new bottom card to locate the hand. The bottom card is available outside the range. Pair, Two Pair, Three and Four only require the cards that form the group.'],
  straight: ['Tìm đúng năm giá trị của sảnh đã cho sau khi cắt. Át có thể đứng đầu A–5 hoặc cuối 10–A. Có thể dùng lá đáy ngoài vùng.', 'Find the five ranks specified after a cut. Ace can start A–5 or end 10–A. The bottom card is available outside the range.'],
};

export function specialBeyondPrompt(question, language) {
  const english = language === 'en';
  if (question.jazz) {
    const [bottom, first, last] = question.args;
    const hand = question.jazz.targetRanks?.join('–') ?? handNames[question.jazz.hand];
    return english ? `Bottom ${bottom}. Find ${hand} in ${first}–${last}.` : `Đáy ${bottom}. Tìm ${hand} trong vùng ${first}–${last}.`;
  }
  if (!question.direction) return null;
  const [first, second] = question.args;
  const location = question.direction === 'above' ? (english ? `above ${first}` : `phía trên ${first}`)
    : question.direction === 'below' ? (english ? `below ${first}` : `phía dưới ${first}`)
      : (english ? `between ${first} and ${second}` : `giữa ${first} và ${second}`);
  if (question.kind === 'value-sum') return english ? `What is the total rank value ${location}?` : `Tổng giá trị các lá ${location} là bao nhiêu?`;
  if (question.kind === 'suit-distribution') return english ? `How many cards of each suit are ${location}?` : `Mỗi chất có bao nhiêu lá ${location}?`;
  const condition = suits[question.condition] ?? (english ? question.condition : question.condition === 'red' ? 'đỏ' : 'đen');
  return english ? `How many ${condition} cards are ${location}?` : `Có bao nhiêu lá ${condition} ${location}?`;
}
