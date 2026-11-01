"""Auditable numerical diagnostics; these are not material-model validation gates."""
from __future__ import annotations

import math
import statistics

import numpy as np
from typing import Any


OBSERVABLES = {"tempK": "K", "pressureBar": "bar", "potentialEnergyEv": "eV", "totalEnergyEv": "eV", "volumeA3": "angstrom^3"}


def recommend_production_window(step: dict[str, Any], rows: list[dict[str, float]]) -> dict[str, Any]:
    """Conservative suffix screening; a candidate is never proof of equilibrium.

    Keep at least half of the stage and require all relevant observables to pass
    the existing autocorrelation/block/stationarity checks on the same window.
    No user-selected production window is changed by this diagnostic.
    """
    result: dict[str, Any] = {
        "status": "insufficient-sampling", "method": "common-window suffix screening with autocorrelation, block error and half-window stationarity",
        "scope": "Candidate only: stationarity of these observables does not prove thermodynamic equilibrium, ensemble validity or model accuracy. Confirm with longer runs and independent initial states.",
        "testedDiscardFractions": [0, 0.1, 0.2, 0.3, 0.4, 0.5], "minimumSamples": 100,
    }
    kind, params = step["kind"], step.get("params", {})
    if kind not in {"nve", "nvt", "npt", "nph", "langevin", "temp-berendsen", "press-berendsen", "rdf", "vacf", "diffusion"} or params.get("tempStartK") != params.get("tempEndK") or (params.get("pressureEndBar") is not None and params.get("pressureEndBar") != params.get("pressureBar")):
        return {**result, "status": "not-applicable", "reason": "An unchanging ensemble without temperature/pressure ramps or imposed deformation is required."}
    required = ["tempK", "pressureBar", "potentialEnergyEv"]
    if kind in {"npt", "nph", "press-berendsen"}:
        required.append("volumeA3")
    if len(rows) < 100 or any(any(key not in row or not math.isfinite(row[key]) for key in ["timePs", *required]) for row in rows):
        return {**result, "reason": "At least 100 finite thermo samples of T, P, potential energy (and volume for pressure-controlled stages) are required."}
    if any(b["timePs"] < a["timePs"] for a, b in zip(rows, rows[1:])):
        return {**result, "reason": "Physical time must increase within one stage."}
    unique = list({row["timePs"]: row for row in rows}.values())
    intervals = [b["timePs"] - a["timePs"] for a, b in zip(unique, unique[1:])]
    if len(unique) < 100 or not intervals or min(intervals) <= 0 or not math.isfinite(max(intervals)) or max(intervals) - min(intervals) > max(intervals) * 1e-6:
        return {**result, "reason": "Uniformly spaced physical-time samples are required; stages are never combined."}
    result["stageRangePs"] = [unique[0]["timePs"], unique[-1]["timePs"]]
    diagnostics = []
    for fraction in result["testedDiscardFractions"]:
        offset = int(len(unique) * fraction)
        selected = unique[offset:]
        if len(selected) < 100:
            break
        observables = {}
        for name in required:
            stats = sampling_statistics([row[name] for row in selected])
            stats["unit"] = OBSERVABLES[name]
            if stats.get("standardDeviation", 0) <= 0 or any(isinstance(value, float) and not math.isfinite(value) for value in stats.values()):
                stats["status"] = "insufficient-sampling"
            if stats.get("statisticalInefficiency") is not None:
                stats["integratedAutocorrelationTimePs"] = stats["statisticalInefficiency"] * intervals[0] / 2
            observables[name] = stats
        passed = all(stats["status"] == "sampling-diagnostics-passed" for stats in observables.values())
        diagnostics.append({"discardFraction": fraction, "startPs": selected[0]["timePs"], "samples": len(selected), "compatible": passed})
        if passed:
            return {**result, "status": "candidate-window", "candidateWindow": {"startPs": selected[0]["timePs"], "endPs": selected[-1]["timePs"]}, "discardedSamples": offset, "observables": observables, "testedWindows": diagnostics}
    return {**result, "reason": "No tested common suffix passed all sampling diagnostics. Retain more data or run longer; no production window is recommended.", "testedWindows": diagnostics}


def sampling_statistics(values: list[float]) -> dict[str, Any]:
    """Initial-positive paired autocorrelation and a two-scale block check.

    Report inadequate data instead of treating frame count as independent samples.
    Sampling assumptions and heuristic adequacy criteria remain explicit.
    """
    n = len(values)
    result: dict[str, Any] = {"samples": n, "method": "initial-positive-paired-autocorrelation; non-overlapping block means", "status": "insufficient-sampling", "adequacyCriteria": {"minimumEffectiveSamples": 20, "minimumBlocksPerScale": 8, "blockErrorRelativeAgreement": 0.25}, "systematicModelErrorIncluded": False}
    if n < 2:
        return result
    mean = statistics.fmean(values)
    variance = statistics.variance(values)
    centered = [value - mean for value in values]
    # Bound work on long thermo logs; retain the fact that correlation was truncated.
    max_lag = min(n // 2, 4096)
    g = 1.0
    terminated = variance == 0
    population_variance = sum(value * value for value in centered) / n
    if population_variance > 0:
        transform_size = 1 << (2 * n - 1).bit_length()
        transform = np.fft.rfft(np.asarray(centered), n=transform_size)
        covariance = np.fft.irfft(transform * transform.conjugate(), n=transform_size)[:max_lag + 1]
        correlation = covariance / np.arange(n, n - len(covariance), -1) / population_variance
        for lag in range(1, max_lag, 2):
            pair = float(correlation[lag] + correlation[lag + 1])
            if pair <= 0:
                terminated = True
                break
            g += 2 * pair
    g = max(1.0, min(float(n), g))
    neff = n / g
    error = math.sqrt(variance / neff)
    base = max(1, math.ceil(g))
    blocks: list[dict[str, Any]] = []
    for size in (base, base * 2):
        means = [statistics.fmean(values[i:i + size]) for i in range(0, n - size + 1, size)]
        block_error = math.sqrt(statistics.variance(means) / len(means)) if len(means) > 1 else None
        blocks.append({"blockSize": size, "blocks": len(means), "standardError": block_error})
    first, second = blocks[0]["standardError"], blocks[1]["standardError"]
    agreement = first is not None and second is not None and abs(first - second) <= 0.25 * max(first, second, 1e-30)
    half = n // 2
    shift = statistics.fmean(values[half:]) - statistics.fmean(values[:half])
    stationary = abs(shift) <= 3 * max(error * 2, 1e-30)
    adequate = neff >= 20 and terminated and agreement and blocks[-1]["blocks"] >= 8 and stationary
    result.update({"mean": mean, "standardDeviation": math.sqrt(variance), "statisticalInefficiency": g, "effectiveSamples": neff, "standardError": error, "blocks": blocks, "blockErrorStable": agreement, "autocorrelationTruncated": not terminated, "stationarity": {"firstSecondHalfMeanDifference": shift, "diagnosticCompatible": stationary, "method": "half-window mean shift versus three estimated standard errors"}, "status": "sampling-diagnostics-passed" if adequate else "insufficient-sampling"})
    return result


def stage_quality(step: dict[str, Any], rows: list[dict[str, float]], production_window: dict[str, Any] | None = None) -> dict[str, Any]:
    kind = step["kind"]
    ensemble = {"vacf": "nve", "diffusion": "nvt", "rdf": "nvt", "heating": "nvt", "cooling": "nvt", "annealing": "nvt", "tensile": "nvt-deform", "compression": "nvt-deform", "shear": "nvt-deform", "pressure-ramp": "nph"}.get(kind, kind)
    evidence: dict[str, Any] = {"ensemble": ensemble, "physicalValidation": "not-assessed", "timestepRefinement": "not-assessed", "ensembleDistributionValidation": "not-assessed", "nveEnergyDrift": {"status": "not-applicable", "reason": "NVE total-energy conservation is only checked for microcanonical dynamics without imposed work."}}
    if kind in {"nve", "vacf"} and len(rows) > 1:
        times = [row["timePs"] for row in rows]
        energy = [row["totalEnergyEv"] for row in rows]
        time_mean, energy_mean = statistics.fmean(times), statistics.fmean(energy)
        denominator = sum((value - time_mean)**2 for value in times)
        if denominator > 0:
            slope = sum((t - time_mean) * (e - energy_mean) for t, e in zip(times, energy)) / denominator
            evidence["nveEnergyDrift"] = {"status": "measured-no-study-tolerance", "slopeEvPerPs": slope, "energyChangeEv": energy[-1] - energy[0], "energyStandardDeviationEv": statistics.stdev(energy), "durationPs": times[-1] - times[0], "scope": "single-stage total energy; no universal pass threshold"}
    if not rows or kind in {"minimization", "velocity", "restart", "coordination", "cna", "centrosymmetry", "voronoi", "stress-atom", "pe-atom", "ke-atom"}:
        evidence["sampling"] = {"status": "not-applicable"}
        return evidence
    start = float(production_window["startPs"]) if production_window else rows[0]["timePs"]
    end = float(production_window["endPs"]) if production_window else rows[-1]["timePs"]
    selected = [row for row in rows if start <= row["timePs"] <= end]
    # Adjacent LAMMPS runs emit a repeated boundary thermo row.
    selected = list({row["timePs"]: row for row in selected}.values())
    intervals = [b["timePs"] - a["timePs"] for a, b in zip(selected, selected[1:])]
    uniform = bool(intervals) and min(intervals) > 0 and max(intervals) - min(intervals) <= max(intervals) * 1e-6
    observables = {name: {"unit": unit, **sampling_statistics([row[name] for row in selected])} for name, unit in OBSERVABLES.items() if selected and all(name in row for row in selected)}
    if not uniform:
        for observable in observables.values():
            observable["status"] = "insufficient-sampling"
            observable["reason"] = "Autocorrelation requires uniformly spaced physical-time samples."
    status = "production-window-required" if not production_window else "sampling-diagnostics-passed" if observables and all(value["status"] == "sampling-diagnostics-passed" for value in observables.values()) else "insufficient-sampling"
    intersection = {"startPs": max(start, rows[0]["timePs"]), "endPs": min(end, rows[-1]["timePs"])}
    requested_covered = bool(selected) and start >= rows[0]["timePs"] and end <= rows[-1]["timePs"]
    evidence["sampling"] = {"status": status, "productionWindow": {"startPs": start, "endPs": end, "source": "user-selected" if production_window else "whole-stage-candidate; equilibration-not-established", "stageSampleRangePs": [rows[0]["timePs"], rows[-1]["timePs"]], "intersectionPs": intersection if selected else None, "selectedSampleRangePs": [selected[0]["timePs"], selected[-1]["timePs"]] if selected else None, "completeRequestedWindow": requested_covered, "coverage": "within-stage" if requested_covered else "stage-limited" if selected else "no-samples-in-window"}, "uniformTimeSampling": uniform, "observables": observables, "equilibrationValidation": "not-assessed", "independentReplicas": "not-assessed"}
    evidence["equilibrationDiagnostic"] = recommend_production_window(step, rows)
    return evidence


def mechanical_series(kind: str, params: dict[str, Any], rows: list[dict[str, float]]) -> dict[str, Any]:
    if not rows:
        return {}
    if kind in {"tensile", "compression"}:
        axis = str(params.get("axis", "z"))
        initial = rows[0][f"l{axis}"]
        direction = -1 if kind == "compression" else 1
        series = []
        for row in rows:
            ratio = row[f"l{axis}"] / initial
            series.append({"step": row["step"], "timePs": row["timePs"], "strain": direction * (ratio - 1), "engineeringStrain": ratio - 1, "trueStrain": math.log(ratio), "stressGPa": direction * -row[f"p{axis}{axis}"] * 1e-4, "cauchyStressGPa": -row[f"p{axis}{axis}"] * 1e-4})
        return {"series": series, "mechanicalDefinition": {"loading": "uniaxial engineering strain rate; fixed lateral cell lengths; NVT", "strain": "signed engineeringStrain and logarithmic trueStrain; display strain positive in loading direction", "stress": "Cauchy stress = -LAMMPS pressure tensor; tension positive; display stress positive in loading direction", "strainRatePerSecond": params.get("strainRatePerSecond"), "zeroLateralStress": False}}
    if kind == "shear":
        plane = str(params.get("shearPlane", "xy"))
        length = rows[0][f"l{plane[1]}"]
        raw_initial = rows[0][plane]
        # erate prescribes displacement relative to the initial perpendicular
        # length. Exact elapsed physical time removes all box-flip ambiguity,
        # even when more than one flip occurs between retained samples.
        rate = params.get("strainRatePerSecond")
        if rate is None:
            raise ValueError("Accumulated shear requires the applied strain rate and physical-time history")
        return {"series": [{"step": row["step"], "timePs": row["timePs"], "strain": float(rate) * 1e-12 * (row["timePs"] - rows[0]["timePs"]), "rawBasisStrain": (row[plane] - raw_initial) / length, "stressGPa": -row[f"p{plane}"] * 1e-4} for row in rows], "mechanicalDefinition": {"loading": "simple shear; fix deform erate units box remap x; NVT", "strain": "accumulated applied engineering shear from rate times elapsed physical time; invariant under periodic box flips", "stress": "Cauchy shear stress = -LAMMPS off-diagonal pressure tensor", "strainRatePerSecond": rate}}
    return {}
