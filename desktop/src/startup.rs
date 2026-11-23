use objc2::{define_class, msg_send, rc::Retained, sel, DefinedClass, MainThreadOnly};
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSBezelStyle, NSBox, NSBoxType, NSButton, NSColor, NSFont,
    NSFontWeightSemibold, NSTextAlignment, NSTextField, NSTitlePosition, NSView, NSWindow,
    NSWindowOrderingMode, NSWorkspace,
};
use objc2_foundation::{
    ns_string, MainThreadMarker, NSLocale, NSNumber, NSObject, NSPoint, NSRect, NSSize, NSString,
};
use objc2_quartz_core::{
    kCAFillModeBackwards, kCAMediaTimingFunctionEaseOut, CABasicAnimation, CACurrentMediaTime,
    CALayer, CAMediaTiming, CAMediaTimingFunction,
};
use tauri::Window;

use crate::cloud_mark::{COLUMNS, ROWS, TILES};

const GROUP_WIDTH: f64 = 510.0;
const GROUP_HEIGHT: f64 = 228.0;
const TILE_SIZE: f64 = 20.0;
const TILE_PITCH: f64 = 23.0;

define_class!(
    // NSObject has no subclassing requirements. AppKit sends button actions
    // on the main thread and the view retains the target for its lifetime.
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = Box<dyn Fn()>]
    struct RetryAction;

    impl RetryAction {
        #[unsafe(method(retry:))]
        fn retry(&self, _sender: &NSButton) {
            (self.ivars())();
        }
    }
);

pub struct StartupView {
    root: Retained<NSBox>,
    status: Retained<NSTextField>,
    retry: Retained<NSButton>,
    tiles: Vec<Retained<NSBox>>,
    _retry_action: Retained<RetryAction>,
    indonesian: bool,
}

impl StartupView {
    pub fn new(window: &Window, on_retry: impl Fn() + 'static) -> tauri::Result<Self> {
        let mtm = MainThreadMarker::new().expect("startup UI requires the AppKit main thread");
        // Tauri owns this NSWindow, and the borrowed pointer is used only here.
        let native = unsafe { &*window.ns_window()?.cast::<NSWindow>() };
        let content = native
            .contentView()
            .expect("Tauri window has a content view");
        let root = flat_box(mtm, content.bounds(), &NSColor::windowBackgroundColor());
        root.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable
                | NSAutoresizingMaskOptions::ViewHeightSizable,
        );
        let surface = root
            .contentView()
            .expect("startup background has a content view");
        let bounds = surface.bounds();
        let center = NSView::initWithFrame(
            NSView::alloc(mtm),
            rect(
                ((bounds.size.width - GROUP_WIDTH) / 2.0).floor(),
                ((bounds.size.height - GROUP_HEIGHT) / 2.0).floor(),
                GROUP_WIDTH,
                GROUP_HEIGHT,
            ),
        );
        center.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewMinXMargin
                | NSAutoresizingMaskOptions::ViewMaxXMargin
                | NSAutoresizingMaskOptions::ViewMinYMargin
                | NSAutoresizingMaskOptions::ViewMaxYMargin,
        );
        surface.addSubview(&center);
        let tiles = make_cloud(mtm, &center);

        let title = NSTextField::labelWithString(ns_string!("Phynite Lab"), mtm);
        title.setFrame(rect(0.0, 99.0, GROUP_WIDTH, 32.0));
        title.setAlignment(NSTextAlignment::Center);
        title.setFont(Some(&NSFont::systemFontOfSize_weight(24.0, unsafe {
            NSFontWeightSemibold
        })));
        center.addSubview(&title);

        let status = NSTextField::wrappingLabelWithString(ns_string!(""), mtm);
        status.setFrame(rect(0.0, 38.0, GROUP_WIDTH, 53.0));
        status.setPreferredMaxLayoutWidth(GROUP_WIDTH);
        status.setMaximumNumberOfLines(3);
        status.setAlignment(NSTextAlignment::Center);
        status.setTextColor(Some(&NSColor::secondaryLabelColor()));
        status.setFont(Some(&NSFont::systemFontOfSize(13.0)));
        center.addSubview(&status);

        let indonesian = NSLocale::preferredLanguages()
            .firstObject()
            .is_some_and(|language| language.to_string().split('-').next() == Some("id"));
        let retry_action = RetryAction::alloc(mtm).set_ivars(Box::new(on_retry));
        // The target implements the selector with the NSButton sender type.
        let retry_action: Retained<RetryAction> = unsafe { msg_send![super(retry_action), init] };
        let retry = unsafe {
            NSButton::buttonWithTitle_target_action(
                if indonesian {
                    ns_string!("Coba lagi")
                } else {
                    ns_string!("Try again")
                },
                Some(&retry_action),
                Some(sel!(retry:)),
                mtm,
            )
        };
        retry.setFrame(rect((GROUP_WIDTH - 116.0) / 2.0, 0.0, 116.0, 32.0));
        retry.setBezelStyle(NSBezelStyle::Push);
        retry.setKeyEquivalent(ns_string!("\r"));
        center.addSubview(&retry);

        content.addSubview(&root);
        let view = Self {
            root,
            status,
            retry,
            tiles,
            _retry_action: retry_action,
            indonesian,
        };
        view.loading();
        Ok(view)
    }

    pub fn loading(&self) {
        self.retry.setHidden(true);
        self.status.setStringValue(if self.indonesian {
            ns_string!("Membuka workspace lokal...")
        } else {
            ns_string!("Starting the local workspace...")
        });
        self.show();
        self.finish_assembly();
        if !NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion() {
            let now = CACurrentMediaTime();
            for (index, tile) in self.tiles.iter().enumerate() {
                if let Some(layer) = tile.layer() {
                    let begin = layer.convertTime_fromLayer(now, None) + index as f64 * 0.035;
                    animate(
                        &layer,
                        ns_string!("transform.translation.y"),
                        -15.0,
                        0.0,
                        begin,
                    );
                    animate(&layer, ns_string!("opacity"), 0.0, 1.0, begin);
                }
            }
        }
    }

    pub fn error(&self, message: &str) {
        self.finish_assembly();
        self.status.setStringValue(&NSString::from_str(message));
        self.retry.setHidden(false);
        self.show();
        if let Some(window) = self.root.window() {
            window.makeFirstResponder(Some(&self.retry));
        }
    }

    pub fn hide(&self) {
        self.finish_assembly();
        self.root.setHidden(true);
    }

    pub fn show(&self) {
        // All hierarchy reads happen on the main thread.
        if let Some(content) = unsafe { self.root.superview() } {
            content.addSubview_positioned_relativeTo(&self.root, NSWindowOrderingMode::Above, None);
        }
        self.root.setHidden(false);
    }

    fn finish_assembly(&self) {
        for tile in &self.tiles {
            if let Some(layer) = tile.layer() {
                layer.removeAllAnimations();
            }
        }
    }
}

fn rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
}

fn flat_box(mtm: MainThreadMarker, bounds: NSRect, fill: &NSColor) -> Retained<NSBox> {
    let surface = NSBox::initWithFrame(NSBox::alloc(mtm), bounds);
    surface.setBoxType(NSBoxType::Custom);
    surface.setTitlePosition(NSTitlePosition::NoTitle);
    surface.setBorderWidth(0.0);
    surface.setContentViewMargins(NSSize::new(0.0, 0.0));
    surface.setFillColor(fill);
    surface
}

fn make_cloud(mtm: MainThreadMarker, center: &NSView) -> Vec<Retained<NSBox>> {
    let width = TILE_PITCH * (COLUMNS - 1) as f64 + TILE_SIZE;
    let left = ((GROUP_WIDTH - width) / 2.0).floor();
    let frame = |column: usize, row: usize| {
        rect(
            left + column as f64 * TILE_PITCH,
            153.0 + row as f64 * TILE_PITCH,
            TILE_SIZE,
            TILE_SIZE,
        )
    };
    let ink = NSColor::labelColor();
    let guide = ink.colorWithAlphaComponent(0.07);
    for row in 0..ROWS {
        for column in 0..COLUMNS {
            center.addSubview(&flat_box(mtm, frame(column, row), &guide));
        }
    }
    TILES
        .into_iter()
        .map(|(column, row)| {
            let tile = flat_box(mtm, frame(column, row), &ink);
            tile.setWantsLayer(true);
            center.addSubview(&tile);
            tile
        })
        .collect()
}

fn animate(layer: &CALayer, key: &NSString, from: f64, to: f64, begin: f64) {
    let animation = CABasicAnimation::animationWithKeyPath(Some(key));
    unsafe {
        animation.setFromValue(Some(&NSNumber::numberWithDouble(from)));
        animation.setToValue(Some(&NSNumber::numberWithDouble(to)));
        animation.setFillMode(kCAFillModeBackwards);
        animation.setTimingFunction(Some(&CAMediaTimingFunction::functionWithName(
            kCAMediaTimingFunctionEaseOut,
        )));
    }
    animation.setDuration(0.24);
    animation.setBeginTime(begin);
    layer.addAnimation_forKey(&animation, Some(key));
}
