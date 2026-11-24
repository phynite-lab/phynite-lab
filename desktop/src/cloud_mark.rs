pub const COLUMNS: usize = 5;
pub const ROWS: usize = 3;

// The eight tiles in public/brand/phynite-mark-light.png, in assembly order.
// Coordinates use AppKit's bottom-left origin. The lower-right tile lands last.
pub const TILES: [(usize, usize); 8] = [
    (0, 0),
    (1, 0),
    (2, 0),
    (1, 1),
    (2, 1),
    (3, 1),
    (2, 2),
    (4, 0),
];
