// FluxyOS — PPh withholding objects (Indonesia)
//
// The named things a business actually withholds on, each carrying its rate, so
// nobody has to remember whether jasa konsultasi is 2% or 15%.
//
// ── What this replaces ───────────────────────────────────────────────────────
// The bill drawer used to ask for "PPh withholding (%)" as a bare number and a
// bare type. That asks the user to already know the answer, which is the one
// thing a person recording a vendor bill usually does not — and a mistyped rate
// is invisible: 2% instead of 15% posts a smaller liability to 2110, the bill
// still balances, and nothing anywhere says the withholding was short.
//
// ── This table is DATA, and it is dated ──────────────────────────────────────
// It follows `TAX_RATES` in tax-engine.js: rates carry `effective_from` so a
// future change can coexist with history rather than silently rewriting it.
// Nothing here is computed — every figure is transcribed from the source named
// against it, and `docs/data-model/tax-center.md` carries the citations.
//
// ── The rate stays editable, on purpose ──────────────────────────────────────
// Two of these cannot be reduced to one number and must not pretend otherwise:
//
//   • Jasa konstruksi has four rates depending on the provider's certification
//     (1,75% / 2,65% / 4% / 6%). The picker offers them separately.
//   • PPh 21 bukan pegawai is DPP 50% × the Pasal 17 progressive scale, so its
//     effective rate depends on the amount. 2,5% is only the first bracket. It
//     is offered with that stated, and the field stays editable — a progressive
//     bracket computed here would be confidently wrong above ~Rp120 juta gross.
//
// So `rate` is a STARTING POINT the user can override, never a locked value.

export const PPH_GROUPS = {
    PPH23: { code: 'PPH23', label: 'PPh 23', note: 'Dipotong saat jasa atau sewa dari rekanan dalam negeri.' },
    PPH4_2: { code: 'PPH4_2', label: 'PPh 4(2) Final', note: 'Bersifat final — tidak bisa dikreditkan oleh penerima.' },
    PPH21: { code: 'PPH21', label: 'PPh 21', note: 'Untuk orang pribadi bukan pegawai.' },
    PPH26: { code: 'PPH26', label: 'PPh 26', note: 'Untuk penerima dari luar negeri.' }
};

/*
 * `npwp_surcharge` — the multiplier applied when the vendor has no NPWP.
 *
 * This is the most common silent error in Indonesian withholding: a vendor
 * without an NPWP is withheld at DOUBLE the PPh 23 rate, and forgetting it
 * leaves the company owing the difference at audit. It is per-object because it
 * does NOT apply everywhere — PPh 4(2) is final at a fixed rate regardless, and
 * PPh 21's surcharge is 20% higher, not 100%.
 *
 * `null` means the surcharge does not apply to this object.
 */
export const PPH_OBJECTS = [
    // ── PPh 23 · 2% ─────────────────────────────────────────────────────────
    { id: 'PPH23_JASA', group: 'PPH23', rate: 2,
      label: 'Jasa lainnya', label_id: 'Jasa lainnya',
      hint: 'Jasa teknik, manajemen, konsultasi, dan jasa lain di luar yang dipotong PPh 21.',
      npwp_surcharge: 2, effective_from: '2015-08-24' },
    { id: 'PPH23_SEWA', group: 'PPH23', rate: 2,
      label: 'Sewa (selain tanah & bangunan)', label_id: 'Sewa selain tanah & bangunan',
      hint: 'Sewa kendaraan, alat berat, mesin. Sewa tanah atau bangunan masuk PPh 4(2).',
      npwp_surcharge: 2, effective_from: '2015-08-24' },
    { id: 'PPH23_DIVIDEN', group: 'PPH23', rate: 15,
      label: 'Dividen, bunga, royalti', label_id: 'Dividen, bunga, royalti',
      hint: 'Ke wajib pajak badan dalam negeri.',
      npwp_surcharge: 2, effective_from: '2015-08-24' },
    { id: 'PPH23_HADIAH', group: 'PPH23', rate: 15,
      label: 'Hadiah & penghargaan', label_id: 'Hadiah & penghargaan',
      hint: 'Di luar hadiah undian, yang dipotong PPh 4(2).',
      npwp_surcharge: 2, effective_from: '2015-08-24' },

    // ── PPh 4(2) final ──────────────────────────────────────────────────────
    { id: 'PPH42_SEWA_TB', group: 'PPH4_2', rate: 10,
      label: 'Sewa tanah & bangunan', label_id: 'Sewa tanah & bangunan',
      hint: 'Final. Kantor, gudang, ruko, lahan.',
      npwp_surcharge: null, effective_from: '2002-05-01' },
    { id: 'PPH42_KONSTRUKSI_KECIL', group: 'PPH4_2', rate: 1.75,
      label: 'Konstruksi — pelaksana, kualifikasi kecil', label_id: 'Konstruksi — pelaksana kualifikasi kecil',
      hint: 'Penyedia jasa bersertifikat kualifikasi kecil.',
      needs_certificate: true, npwp_surcharge: null, effective_from: '2022-02-21' },
    { id: 'PPH42_KONSTRUKSI_MENENGAH', group: 'PPH4_2', rate: 2.65,
      label: 'Konstruksi — pelaksana, menengah/besar', label_id: 'Konstruksi — pelaksana menengah/besar',
      hint: 'Penyedia jasa bersertifikat kualifikasi menengah atau besar.',
      needs_certificate: true, npwp_surcharge: null, effective_from: '2022-02-21' },
    { id: 'PPH42_KONSTRUKSI_TANPA', group: 'PPH4_2', rate: 4,
      label: 'Konstruksi — tanpa sertifikat', label_id: 'Konstruksi — tanpa sertifikat',
      hint: 'Penyedia jasa yang tidak punya sertifikat badan usaha.',
      needs_certificate: false, npwp_surcharge: null, effective_from: '2022-02-21' },
    { id: 'PPH42_KONSTRUKSI_PERANCANG', group: 'PPH4_2', rate: 6,
      label: 'Konstruksi — perancang / pengawas', label_id: 'Konstruksi — perancang atau pengawas',
      hint: 'Perancang atau pengawas bersertifikat.',
      needs_certificate: true, npwp_surcharge: null, effective_from: '2022-02-21' },

    // ── PPh 21 · bukan pegawai ──────────────────────────────────────────────
    { id: 'PPH21_BUKAN_PEGAWAI', group: 'PPH21', rate: 2.5,
      label: 'Bukan pegawai (jasa orang pribadi)', label_id: 'Bukan pegawai',
      // Stated, not hidden: 2,5% is DPP 50% × the 5% first bracket. Above the
      // first bracket the effective rate rises, and this field is editable
      // precisely so a bigger fee is not silently under-withheld.
      hint: 'DPP 50% × tarif Pasal 17. 2,5% berlaku untuk bruto di bracket pertama — periksa dan sesuaikan untuk nilai besar.',
      progressive: true, npwp_surcharge: 1.2, effective_from: '2024-01-01' },

    // ── PPh 26 · luar negeri ────────────────────────────────────────────────
    { id: 'PPH26_UMUM', group: 'PPH26', rate: 20,
      label: 'Penerima luar negeri', label_id: 'Penerima luar negeri',
      hint: 'Tarif umum 20%, atau tarif P3B jika ada Surat Keterangan Domisili.',
      npwp_surcharge: null, effective_from: '2009-01-01' }
];

const BY_ID = PPH_OBJECTS.reduce((m, o) => { m[o.id] = o; return m; }, {});

export function pphObject(id) { return BY_ID[id] || null; }

export function pphObjectsByGroup() {
    return Object.keys(PPH_GROUPS).map((code) => ({
        ...PPH_GROUPS[code],
        objects: PPH_OBJECTS.filter((o) => o.group === code)
    })).filter((g) => g.objects.length);
}

/*
 * The rate actually applied, given the object and whether the vendor has an
 * NPWP. Returns the surcharge separately so the UI can SAY why the number
 * changed rather than just changing it — a rate that doubles with no
 * explanation reads as a bug.
 */
export function effectiveRate(objectId, { hasNpwp = true } = {}) {
    const obj = BY_ID[objectId];
    if (!obj) return { rate: 0, base: 0, surcharged: false };
    const base = Number(obj.rate) || 0;
    const applies = !hasNpwp && obj.npwp_surcharge;
    // Rates are quoted to two decimals (1,75% / 2,65%), so the multiplied rate
    // is rounded the same way rather than carrying float noise into the field.
    const rate = applies ? Math.round(base * obj.npwp_surcharge * 100) / 100 : base;
    return { rate, base, surcharged: !!applies, multiplier: applies ? obj.npwp_surcharge : 1 };
}

// What the engine stores. `withholding_code` is the group, because that is the
// axis the Tax Center reports and the Bukti Potong export groups by;
// `withholding_type` is the human label that appears on the journal line.
export function withholdingFieldsFor(objectId, { hasNpwp = true } = {}) {
    const obj = BY_ID[objectId];
    if (!obj) return null;
    const { rate } = effectiveRate(objectId, { hasNpwp });
    return {
        withholding_rate: rate,
        withholding_type: `${PPH_GROUPS[obj.group].label} — ${obj.label}`,
        withholding_code: obj.group,
        withholding_object_id: obj.id,
        withholding_npwp: hasNpwp
    };
}
