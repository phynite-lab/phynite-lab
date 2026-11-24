use std::cell::RefCell;

const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_VALUES: usize = 4_000_000;
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

#[derive(Default)]
struct Buffers {
    input: Vec<u8>,
    values: Vec<f64>,
}

thread_local! {
    static BUFFERS: RefCell<Buffers> = RefCell::new(Buffers::default());
}

#[no_mangle]
pub extern "C" fn reserve_input(length: usize) -> *mut u8 {
    BUFFERS.with_borrow_mut(|buffers| {
        if length == 0 || length > MAX_BYTES {
            return std::ptr::null_mut();
        }
        buffers.input.resize(length, 0);
        buffers.input.as_mut_ptr()
    })
}

#[no_mangle]
pub extern "C" fn parse_rows(
    rows: usize,
    width: usize,
    id_column: i32,
    type_column: i32,
) -> *const f64 {
    BUFFERS.with_borrow_mut(|Buffers { input, values }| {
        if parse(input, values, rows, width, [id_column, type_column]).is_some() {
            values.as_ptr()
        } else {
            std::ptr::null()
        }
    })
}

fn parse(
    input: &[u8],
    values: &mut Vec<f64>,
    rows: usize,
    width: usize,
    labels: [i32; 2],
) -> Option<()> {
    let count = rows.checked_mul(width)?;
    if !(1..=MAX_VALUES).contains(&count) {
        return None;
    }
    let text = std::str::from_utf8(input).ok()?;
    values.clear();
    values.reserve(count);
    let mut lines = text.lines();
    for _ in 0..rows {
        let mut fields = lines.next()?.split_ascii_whitespace();
        for column in 0..width {
            let token = fields.next()?;
            let value: f64 = token.parse().ok()?;
            if !value.is_finite() {
                return None;
            }
            if labels.contains(&(column as i32)) {
                // IDs and numeric species must round-trip to the exact input spelling.
                let canonical = token.as_bytes().iter().all(u8::is_ascii_digit)
                    && (token.len() == 1 || !token.starts_with('0'));
                if !canonical || value > MAX_SAFE_INTEGER {
                    return None;
                }
            }
            values.push(value);
        }
        if fields.next().is_some() {
            return None;
        }
    }
    lines.next().is_none().then_some(())
}
