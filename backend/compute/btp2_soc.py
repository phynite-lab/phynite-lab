from __future__ import annotations

import copy
import sys
import xml.etree.ElementTree as ET

import numpy as np


def install_noncollinear_espresso_adapter() -> None:
    import BoltzTraP2.io

    original = BoltzTraP2.io._parse_ESPRESSO_bands

    def parse_bands(xml_tree: ET.ElementTree):
        bands = xml_tree.find("./output/band_structure")
        noncolin = bands.find("./noncolin") if bands is not None else None
        if noncolin is None or noncolin.text != "true":
            return original(xml_tree)

        adapted = copy.deepcopy(xml_tree)
        adapted_bands = adapted.find("./output/band_structure")
        if adapted_bands is None:
            return original(xml_tree)
        adapted_noncolin = adapted_bands.find("./noncolin")
        adapted_lsda = adapted_bands.find("./lsda")
        adapted_nbnd = adapted_bands.find("./nbnd")
        if adapted_noncolin is None or adapted_lsda is None or adapted_nbnd is None:
            raise ValueError("incomplete non-collinear ESPRESSO band metadata")

        band_count = int(adapted_nbnd.text)
        if band_count % 2:
            raise ValueError("non-collinear ESPRESSO adapter requires an even number of spinor bands")
        adapted_noncolin.text = "false"
        adapted_lsda.text = "true"
        ET.SubElement(adapted_bands, "nbnd_up").text = str(band_count // 2)
        ET.SubElement(adapted_bands, "nbnd_dw").text = str(band_count // 2)
        parsed = original(adapted)
        parsed["noncollinearSpinorBands"] = True
        return parsed

    BoltzTraP2.io._parse_ESPRESSO_bands = parse_bands


def install_band_window_validation() -> None:
    """Replace BoltzTraP2's opaque LAPACK failure for an empty band window."""
    import BoltzTraP2.dft

    original = BoltzTraP2.dft.DFTData.bandana

    def validated_bandana(self, emin=-np.inf, emax=np.inf):
        accepted = original(self, emin, emax)
        if not np.any(accepted):
            raise ValueError(
                "BoltzTraP2 band-interpolation window contains no DFT bands. "
                "Use a wider interpolation energy window; the chemical-potential "
                "plot range must not be used as the band filter."
            )
        if not np.isfinite(self.ebands).all():
            raise ValueError("Quantum ESPRESSO produced non-finite band energies for BoltzTraP2")
        return accepted

    BoltzTraP2.dft.DFTData.bandana = validated_bandana


def main() -> int:
    install_noncollinear_espresso_adapter()
    install_band_window_validation()
    from BoltzTraP2.interface import btp2_main

    result = btp2_main()
    return int(result) if isinstance(result, int) else 0


if __name__ == "__main__":
    sys.exit(main())
