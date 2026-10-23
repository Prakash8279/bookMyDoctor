import 'package:flutter/material.dart';
import '../doctor/doctor_appointments_screen.dart';

/// Both staff roles share the website's appointment table workflow.
/// Backend role scoping/masking remains authoritative; clinical detail UI is disabled here.
class ReceptionistAppointmentsScreen extends StatelessWidget {
  const ReceptionistAppointmentsScreen({super.key});
  @override
  Widget build(BuildContext context) =>
      const DoctorAppointmentsScreen(showClinicalDetails: false);
}
