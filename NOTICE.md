# Attribution and third-party licenses

Phynite's local application is distributed under GNU AGPL v3 only. Third-party
licenses apply to their respective components and are not replaced by AGPL.

- The integrated MD viewer comes from `jauhar-nr/md-prototype`, commit
  `fcef385d046c2425a008e798273213c073bc9ef6`, with Phynite adaptations. The project
  owner confirmed redistribution permission for this integration. Preserve
  `components/md-prototype/UPSTREAM.md` and `upstream.json` in corresponding source.
- SSSP 1.3.0 PBE cutoff metadata is distributed under CC-BY-4.0. Preserve the
  source, citations, license and attribution in `data/sssp/README.md` and
  `data/sssp/LICENSE.txt`. Pseudopotential binaries are separate downloads and
  are not included in this source or npm distribution.
- Geist, Geist Mono, Geist Pixel and Space Grotesk use their included SIL Open
  Font License notices. Publication fonts retain their Bitstream/DejaVu/Arev
  notices. The source tree keeps these under `public/fonts/`; native packages
  keep them under `app/public/fonts/`. See the font README for verified origins.
- KaTeX JavaScript retains its MIT license; its emitted fonts retain the separate
  SIL Open Font License, copyright and reserved font names recorded in
  `distribution/notices/web/`. Native packages include those full notices.
- JavaScript and frozen-core dependencies retain the actual license texts and
  exact package versions collected in each native package's
  `THIRD_PARTY_NOTICES.md`. Those dependencies are licensed separately.
- Linux sandbox components retain their original licenses and source notices
  under `distribution/notices/bootstrap/`. Matching source archives and build
  recipes are included in `distribution/sources/bootstrap/` and the corresponding
  source release. Scientific runtimes have their own installed license records.

Each release links the exact public source commit and includes corresponding
source and build scripts. Preserve all notices when redistributing or modifying
the application. The source offer and each dependency's license obligations
apply independently of where a repository is hosted.
