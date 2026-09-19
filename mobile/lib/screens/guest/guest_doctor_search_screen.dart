import 'package:flutter/material.dart';

import '../patient/patient_search_screen.dart';

/// Thin Scaffold wrapper — PatientSearchScreen itself is a bare body widget (no AppBar), designed
/// to sit inside RoleScaffold's shell for a logged-in patient. Guest browsing has no such shell,
/// so this gives it one. The screen's own logic (GET /doctors, optionalAuthenticate) is identical
/// either way.
///
/// BUG FIX (duplicate header): this used to also render its own kicker/title/subtitle Padding
/// above PatientSearchScreen, mirroring the web app's public search page (client/src/pages/
/// PublicPages.jsx#SearchResults: "Verified healthcare network" / "Find your doctor" / "Compare
/// expertise, location, fees, and live availability before you book.") — but PatientSearchScreen
/// now renders that exact same PageHeader itself (see its "Filters" panel rebuild), so keeping it
/// here too showed it twice, stacked on top of itself. Removed; PatientSearchScreen supplies it.
class GuestDoctorSearchScreen extends StatelessWidget {
  /// Passed straight through to PatientSearchScreen — lets the guest home hero search hand off
  /// a keyword/specialization/city/clinic the visitor already picked there.
  final String? initialQuery;
  final String? initialSpecializationId;
  final String? initialCity;
  final String? initialClinicName;

  const GuestDoctorSearchScreen({
    super.key,
    this.initialQuery,
    this.initialSpecializationId,
    this.initialCity,
    this.initialClinicName,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Find doctors')),
      body: PatientSearchScreen(
        initialQuery: initialQuery,
        initialSpecializationId: initialSpecializationId,
        initialCity: initialCity,
        initialClinicName: initialClinicName,
      ),
    );
  }
}
