use std::{cell::Cell, rc::Rc};

use objc2::{define_class, msg_send, rc::Retained, sel, DefinedClass, MainThreadOnly};
use objc2_app_kit::{
    NSAccessibility, NSBezelStyle, NSColor, NSFont, NSFontWeightSemibold, NSPopUpButton,
    NSTextField, NSWindow,
};
use objc2_foundation::{MainThreadMarker, NSObject, NSPoint, NSRect, NSSize, NSString};
use serde::Deserialize;
use tauri::Window;

pub const WIDTH: f64 = 500.0;
pub const HEIGHT: f64 = 340.0;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    System,
    Light,
    Dark,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    System,
    En,
    Id,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Density {
    Comfortable,
    Compact,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Motion {
    System,
    On,
    Off,
}

#[derive(Clone, Copy)]
pub struct Preferences {
    pub theme: Theme,
    pub locale: Language,
    pub density: Density,
    pub motion: Motion,
}

#[derive(Clone, Copy)]
pub enum Action {
    Preference(&'static str, &'static str),
    Navigate(&'static str),
}

struct PopupHandler {
    callback: Rc<dyn Fn(Action)>,
    options: Vec<Action>,
    resets: bool,
}

define_class!(
    // Popup controls send their actions on the AppKit main thread.
    #[unsafe(super = NSObject)]
    #[thread_kind = MainThreadOnly]
    #[ivars = PopupHandler]
    struct PopupTarget;

    impl PopupTarget {
        #[unsafe(method(selectionChanged:))]
        fn changed(&self, sender: &NSPopUpButton) {
            let handler = self.ivars();
            let mut index = sender.indexOfSelectedItem();
            if handler.resets {
                sender.selectItemAtIndex(0);
                index -= 1;
            }
            if let Some(action) = handler.options.get(index as usize) {
                (handler.callback)(*action);
            }
        }
    }
);

struct Popup {
    label: Retained<NSTextField>,
    button: Retained<NSPopUpButton>,
    _target: Retained<PopupTarget>,
}

type Choice = (&'static str, &'static str, Action);
const THEME: &[Choice] = &[
    ("System", "Sistem", Action::Preference("theme", "system")),
    ("Light", "Terang", Action::Preference("theme", "light")),
    ("Dark", "Gelap", Action::Preference("theme", "dark")),
];
const LANGUAGE: &[Choice] = &[
    ("System", "Sistem", Action::Preference("locale", "system")),
    ("English", "English", Action::Preference("locale", "en")),
    (
        "Bahasa Indonesia",
        "Bahasa Indonesia",
        Action::Preference("locale", "id"),
    ),
];
const DENSITY: &[Choice] = &[
    (
        "Comfortable",
        "Nyaman",
        Action::Preference("density", "comfortable"),
    ),
    (
        "Compact",
        "Ringkas",
        Action::Preference("density", "compact"),
    ),
];
const MOTION: &[Choice] = &[
    ("System", "Sistem", Action::Preference("motion", "system")),
    ("On", "Aktif", Action::Preference("motion", "on")),
    ("Off", "Nonaktif", Action::Preference("motion", "off")),
];
const SECTIONS: &[Choice] = &[
    (
        "Advanced appearance",
        "Tampilan lanjutan",
        Action::Navigate("/account/appearance"),
    ),
    (
        "Keyboard shortcuts",
        "Pintasan keyboard",
        Action::Navigate("/account/keyboard"),
    ),
    (
        "Notifications",
        "Notifikasi",
        Action::Navigate("/account/notifications"),
    ),
    ("Compute", "Komputasi", Action::Navigate("/account/compute")),
    (
        "AI provider accounts",
        "Akun provider AI",
        Action::Navigate("/account/ai-providers"),
    ),
    ("Account", "Akun", Action::Navigate("/account/account")),
    ("Usage", "Pemakaian", Action::Navigate("/account/usage")),
    (
        "Storage",
        "Penyimpanan",
        Action::Navigate("/account/storage"),
    ),
    (
        "Privacy & session",
        "Privasi & sesi",
        Action::Navigate("/account/privacy"),
    ),
];

pub struct SettingsView {
    title: Retained<NSTextField>,
    status: Retained<NSTextField>,
    theme: Popup,
    language: Popup,
    density: Popup,
    motion: Popup,
    sections: Popup,
    indonesian: Cell<Option<bool>>,
}

impl SettingsView {
    pub fn new(window: &Window, on_action: impl Fn(Action) + 'static) -> tauri::Result<Self> {
        let mtm = MainThreadMarker::new().expect("settings requires the AppKit main thread");
        // The borrowed NSWindow remains owned by Tauri.
        let native = unsafe { &*window.ns_window()?.cast::<NSWindow>() };
        let root = native.contentView().expect("settings content view");
        let callback: Rc<dyn Fn(Action)> = Rc::new(on_action);
        let top = root.convertRect_fromView(native.contentLayoutRect(), None);
        let top = top.origin.y + top.size.height;
        let title = label(mtm, 32.0, top - 49.0, 436.0);
        title.setFont(Some(&NSFont::systemFontOfSize_weight(25.0, unsafe {
            NSFontWeightSemibold
        })));
        title.setFrameSize(NSSize::new(436.0, 35.0));
        let status = label(mtm, 32.0, top - 72.0, 436.0);
        status.setTextColor(Some(&NSColor::secondaryLabelColor()));
        root.addSubview(&title);
        root.addSubview(&status);
        let make = |choices, y, resets| popup(mtm, choices, y, resets, Rc::clone(&callback));
        let view = Self {
            title,
            status,
            theme: make(THEME, 201.0, false),
            language: make(LANGUAGE, 159.0, false),
            density: make(DENSITY, 117.0, false),
            motion: make(MOTION, 75.0, false),
            sections: make(SECTIONS, 27.0, true),
            indonesian: Cell::new(None),
        };
        for control in [
            &view.theme,
            &view.language,
            &view.density,
            &view.motion,
            &view.sections,
        ] {
            root.addSubview(&control.label);
            root.addSubview(&control.button);
        }
        view.update(None);
        Ok(view)
    }

    pub fn update(&self, value: Option<Preferences>) {
        let language = value.map(|prefs| prefs.locale).unwrap_or(Language::System);
        let id = match language {
            Language::Id => true,
            Language::En => false,
            Language::System => objc2_foundation::NSLocale::preferredLanguages()
                .firstObject()
                .is_some_and(|value| value.to_string().split('-').next() == Some("id")),
        };
        if self.indonesian.replace(Some(id)) != Some(id) {
            self.title
                .setStringValue(&title(id, "Settings", "Pengaturan"));
            self.theme
                .localize(id, "Appearance", "Tampilan", THEME, false);
            self.language
                .localize(id, "Language", "Bahasa", LANGUAGE, false);
            self.density
                .localize(id, "Density", "Kepadatan", DENSITY, false);
            self.motion
                .localize(id, "Reduce motion", "Kurangi gerakan", MOTION, false);
            self.sections.localize(
                id,
                "Workspace settings",
                "Pengaturan workspace",
                SECTIONS,
                true,
            );
        }
        let status = if value.is_some() {
            title(id, "Applies to this Mac.", "Berlaku di Mac ini.")
        } else {
            title(
                id,
                "Waiting for the local workspace…",
                "Menunggu workspace lokal…",
            )
        };
        self.status.setStringValue(&status);
        for control in [
            &self.theme,
            &self.language,
            &self.density,
            &self.motion,
            &self.sections,
        ] {
            control.button.setEnabled(value.is_some());
        }
        if let Some(value) = value {
            self.theme.button.selectItemAtIndex(value.theme as isize);
            self.language
                .button
                .selectItemAtIndex(value.locale as isize);
            self.density
                .button
                .selectItemAtIndex(value.density as isize);
            self.motion.button.selectItemAtIndex(value.motion as isize);
        }
    }
}

impl Popup {
    fn localize(&self, id: bool, en: &str, indonesian: &str, choices: &[Choice], resets: bool) {
        let name = title(id, en, indonesian);
        self.label.setStringValue(&name);
        self.button.setAccessibilityLabel(Some(&name));
        self.button.removeAllItems();
        if resets {
            self.button
                .addItemWithTitle(&title(id, "Open section…", "Buka bagian…"));
        }
        for (en, indonesian, _) in choices {
            self.button.addItemWithTitle(&title(id, en, indonesian));
        }
    }
}

fn rect(x: f64, y: f64, width: f64, height: f64) -> NSRect {
    NSRect::new(NSPoint::new(x, y), NSSize::new(width, height))
}

fn label(mtm: MainThreadMarker, x: f64, y: f64, width: f64) -> Retained<NSTextField> {
    let text = NSTextField::labelWithString(&NSString::new(), mtm);
    text.setFrame(rect(x, y, width, 22.0));
    text
}

fn title(id: bool, en: &str, indonesian: &str) -> Retained<NSString> {
    NSString::from_str(if id { indonesian } else { en })
}

fn popup(
    mtm: MainThreadMarker,
    choices: &[Choice],
    y: f64,
    resets: bool,
    callback: Rc<dyn Fn(Action)>,
) -> Popup {
    let target = PopupTarget::alloc(mtm).set_ivars(PopupHandler {
        callback,
        options: choices.iter().map(|(_, _, action)| *action).collect(),
        resets,
    });
    // Keep the target alive as AppKit controls keep a weak reference.
    let target: Retained<PopupTarget> = unsafe { msg_send![super(target), init] };
    let button = NSPopUpButton::initWithFrame_pullsDown(
        NSPopUpButton::alloc(mtm),
        rect(258.0, y, 210.0, 28.0),
        resets,
    );
    button.setBezelStyle(NSBezelStyle::Push);
    unsafe {
        button.setTarget(Some(&target));
        button.setAction(Some(sel!(selectionChanged:)));
    }
    Popup {
        label: label(mtm, 32.0, y + 3.0, 210.0),
        button,
        _target: target,
    }
}
