use std::{cell::RefCell, rc::Rc};

use objc2::{define_class, msg_send, rc::Retained, sel, DefinedClass, MainThreadOnly};
use objc2_app_kit::{
    NSAccessibility, NSAccessibilityTabButtonSubrole, NSAutoresizingMaskOptions, NSBorderType,
    NSBox, NSBoxType, NSButton, NSColor, NSFont, NSFontWeightMedium, NSFontWeightSemibold,
    NSScrollView, NSScrollerStyle, NSTextAlignment, NSTitlePosition, NSView, NSWindow,
    NSWindowOrderingMode,
};
use objc2_foundation::{
    ns_string, MainThreadMarker, NSLocale, NSObject, NSPoint, NSRect, NSSize, NSString,
};
use tauri::Window;

pub const HEIGHT: f64 = 42.0;
const RIGHT_WIDTH: f64 = 46.0;
const EDGE: f64 = 8.0;
const TAB_HEIGHT: f64 = 28.0;

#[derive(Clone, PartialEq, Eq)]
pub struct Tab {
    pub id: String,
    pub label: String,
    pub closable: bool,
}

#[derive(Clone)]
pub enum TabAction {
    Select(String),
    Close(String),
    New,
}

struct TabHandler {
    callback: Rc<dyn Fn(TabAction)>,
    action: TabAction,
}

define_class!(
    // NSObject has no subclassing requirements. Retained controls own their
    // targets, and [NSControl sendAction] runs on the AppKit main thread.
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = TabHandler]
    struct TabTarget;

    impl TabTarget {
        #[unsafe(method(performProjectTabAction:))]
        fn perform(&self, _sender: &NSButton) {
            let handler = self.ivars();
            (handler.callback)(handler.action.clone());
        }
    }
);

struct Button {
    view: Retained<NSButton>,
    _target: Retained<TabTarget>,
}

impl Button {
    fn new(
        mtm: MainThreadMarker,
        title: &NSString,
        callback: Rc<dyn Fn(TabAction)>,
        action: TabAction,
    ) -> Self {
        let target = TabTarget::alloc(mtm).set_ivars(TabHandler { callback, action });
        // AppKit retains the control, but its target is held by this struct.
        let target: Retained<TabTarget> = unsafe { msg_send![super(target), init] };
        let view = unsafe {
            NSButton::buttonWithTitle_target_action(
                title,
                Some(&target),
                Some(sel!(performProjectTabAction:)),
                mtm,
            )
        };
        view.setBordered(false);
        Self {
            view,
            _target: target,
        }
    }
}

struct TabControl {
    tab: Tab,
    plate: Retained<NSBox>,
    underline: Retained<NSBox>,
    select: Button,
    _close: Option<Button>,
}

pub struct ProjectTabs {
    root: Retained<NSBox>,
    scroll: Retained<NSScrollView>,
    document: Retained<NSView>,
    tabs: RefCell<Vec<TabControl>>,
    callback: Rc<dyn Fn(TabAction)>,
    _add: Button,
    indonesian: bool,
}

impl ProjectTabs {
    pub fn new(window: &Window, on_action: impl Fn(TabAction) + 'static) -> tauri::Result<Self> {
        let mtm = MainThreadMarker::new().expect("project tabs require the AppKit main thread");
        // Tauri owns this live NSWindow. We borrow it for AppKit setup.
        let native = unsafe { &*window.ns_window()?.cast::<NSWindow>() };
        let content = native
            .contentView()
            .expect("Tauri window has a content view");
        let bounds = content.bounds();
        let width = bounds.size.width;
        let usable = content.convertRect_fromView(native.contentLayoutRect(), None);
        let root = box_view(
            mtm,
            rect(
                0.0,
                usable.origin.y + usable.size.height - HEIGHT,
                width,
                HEIGHT,
            ),
            &NSColor::windowBackgroundColor(),
        );
        root.setAutoresizingMask(
            NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewMinYMargin,
        );
        let surface = root
            .contentView()
            .expect("project tab strip has a content view");
        let divider = box_view(mtm, rect(0.0, 0.0, width, 1.0), &NSColor::separatorColor());
        divider.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable);
        surface.addSubview(&divider);

        let scroll = NSScrollView::initWithFrame(
            NSScrollView::alloc(mtm),
            rect(0.0, 1.0, (width - RIGHT_WIDTH).max(1.0), HEIGHT - 1.0),
        );
        scroll.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable);
        scroll.setBorderType(NSBorderType::NoBorder);
        scroll.setDrawsBackground(false);
        scroll.setHasHorizontalScroller(true);
        scroll.setHasVerticalScroller(false);
        scroll.setScrollerStyle(NSScrollerStyle::Overlay);
        scroll.setAutohidesScrollers(true);
        let document = NSView::initWithFrame(NSView::alloc(mtm), rect(0.0, 0.0, 1.0, HEIGHT - 1.0));
        scroll.setDocumentView(Some(&document));
        surface.addSubview(&scroll);

        let callback: Rc<dyn Fn(TabAction)> = Rc::new(on_action);
        let indonesian = NSLocale::preferredLanguages()
            .firstObject()
            .is_some_and(|language| language.to_string().split('-').next() == Some("id"));
        let new_label = if indonesian {
            ns_string!("Tab baru")
        } else {
            ns_string!("New tab")
        };
        let add = Button::new(mtm, ns_string!("+"), Rc::clone(&callback), TabAction::New);
        add.view.setFrame(rect(width - 39.0, 6.0, 32.0, 30.0));
        add.view
            .setAutoresizingMask(NSAutoresizingMaskOptions::ViewMinXMargin);
        add.view.setFont(Some(&NSFont::systemFontOfSize(19.0)));
        add.view.setAccessibilityLabel(Some(new_label));
        add.view.setToolTip(Some(new_label));
        surface.addSubview(&add.view);
        root.setHidden(true);
        content.addSubview(&root);

        Ok(Self {
            root,
            scroll,
            document,
            tabs: RefCell::new(Vec::new()),
            callback,
            _add: add,
            indonesian,
        })
    }

    pub fn update(&self, tabs: &[Tab], active: &str) {
        let mtm = self.root.mtm();
        let mut controls = self.tabs.borrow_mut();
        if !controls.iter().map(|control| &control.tab).eq(tabs.iter()) {
            for control in controls.drain(..) {
                control.plate.removeFromSuperview();
            }
            let mut x = EDGE;
            for tab in tabs {
                let control = self.make_tab(mtm, tab, x);
                x += control.plate.frame().size.width + 3.0;
                self.document.addSubview(&control.plate);
                controls.push(control);
            }
            self.document
                .setFrameSize(NSSize::new(x + EDGE, HEIGHT - 1.0));
        }
        for control in controls.iter() {
            let selected = control.tab.id == active;
            let weight = unsafe {
                if selected {
                    NSFontWeightSemibold
                } else {
                    NSFontWeightMedium
                }
            };
            control
                .select
                .view
                .setFont(Some(&NSFont::systemFontOfSize_weight(13.0, weight)));
            control.select.view.setAccessibilitySelected(selected);
            control.underline.setHidden(!selected);
            let alpha = if selected { 0.11 } else { 0.0 };
            control
                .plate
                .setFillColor(&NSColor::labelColor().colorWithAlphaComponent(alpha));
            if selected {
                self.document.scrollRectToVisible(control.plate.frame());
            }
        }
    }

    pub fn set_visible(&self, visible: bool) {
        self.root.setHidden(!visible);
        if visible {
            // The WebView can be created after the strip. Keep AppKit controls
            // above the WebView while the native project surface is active.
            if let Some(content) = unsafe { self.root.superview() } {
                content.addSubview_positioned_relativeTo(
                    &self.root,
                    NSWindowOrderingMode::Above,
                    None,
                );
            }
            self.scroll.flashScrollers();
        }
    }

    fn make_tab(&self, mtm: MainThreadMarker, tab: &Tab, x: f64) -> TabControl {
        let label = NSString::from_str(&tab.label);
        let select = Button::new(
            mtm,
            &label,
            Rc::clone(&self.callback),
            TabAction::Select(tab.id.clone()),
        );
        select.view.setAlignment(NSTextAlignment::Left);
        select
            .view
            .setFont(Some(&NSFont::systemFontOfSize_weight(13.0, unsafe {
                NSFontWeightSemibold
            })));
        select.view.setToolTip(Some(&label));
        unsafe {
            select
                .view
                .setAccessibilitySubrole(Some(NSAccessibilityTabButtonSubrole));
        }
        let text_width = (select.view.fittingSize().width + 12.0)
            .clamp(62.0, 210.0)
            .ceil();
        let width = text_width + if tab.closable { 29.0 } else { 9.0 };
        let plate = box_view(mtm, rect(x, 7.0, width, TAB_HEIGHT), &NSColor::clearColor());
        plate.setCornerRadius(6.0);
        let surface = plate.contentView().expect("project tab has a content view");
        select.view.setFrame(rect(9.0, 0.0, text_width, TAB_HEIGHT));
        surface.addSubview(&select.view);

        let underline = box_view(
            mtm,
            rect((width - 18.0) / 2.0, 1.0, 18.0, 2.0),
            &NSColor::controlAccentColor(),
        );
        underline.setCornerRadius(1.0);
        surface.addSubview(&underline);
        let close = tab.closable.then(|| {
            let button = Button::new(
                mtm,
                ns_string!("×"),
                Rc::clone(&self.callback),
                TabAction::Close(tab.id.clone()),
            );
            let prefix = if self.indonesian { "Tutup" } else { "Close" };
            let tooltip = NSString::from_str(&format!("{prefix} {}", tab.label));
            button.view.setFrame(rect(width - 24.0, 2.0, 20.0, 24.0));
            button.view.setFont(Some(&NSFont::systemFontOfSize(15.0)));
            button
                .view
                .setContentTintColor(Some(&NSColor::secondaryLabelColor()));
            button.view.setToolTip(Some(&tooltip));
            button.view.setAccessibilityLabel(Some(&tooltip));
            surface.addSubview(&button.view);
            button
        });

        TabControl {
            tab: tab.clone(),
            plate,
            underline,
            select,
            _close: close,
        }
    }
}

fn box_view(mtm: MainThreadMarker, frame: NSRect, color: &NSColor) -> Retained<NSBox> {
    let view = NSBox::initWithFrame(NSBox::alloc(mtm), frame);
    view.setBoxType(NSBoxType::Custom);
    view.setTitlePosition(NSTitlePosition::NoTitle);
    view.setBorderWidth(0.0);
    view.setContentViewMargins(NSSize::new(0.0, 0.0));
    view.setFillColor(color);
    view
}

fn rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
}
