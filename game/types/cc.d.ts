/**
 * Stub cho module `cc` của Cocos Creator.
 *
 * Repo KHÔNG commit type thật của engine: `temp/tsconfig.cocos.json` (do editor sinh)
 * trỏ vào `library/`, cả hai đều gitignored, nên CI không thể resolve `cc`.
 *
 * Vì vậy `tsc --noEmit` coi `cc` là module any:
 *  - vẫn bắt được lỗi kiểu/logic trong code của mình
 *  - KHÔNG kiểm tra được API của Cocos → editor là nguồn đúng cho phần đó
 *
 * Đừng thêm nội dung vào file này để "fix" lỗi. Nếu cần type của engine,
 * mở project trong editor rồi dùng `npm run typecheck:all`.
 */
declare module 'cc';
