import 'dart:math' as math;

import '../models/core_models.dart';

double? clinicDistanceKm(
    double latitude, double longitude, ClinicSummary clinic) {
  final targetLat = clinic.latitude;
  final targetLng = clinic.longitude;
  if (targetLat == null ||
      targetLng == null ||
      targetLat.abs() > 90 ||
      targetLng.abs() > 180) {
    return null;
  }
  double radians(double value) => value * math.pi / 180;
  final deltaLat = radians(targetLat - latitude);
  final deltaLng = radians(targetLng - longitude);
  final arc = math.pow(math.sin(deltaLat / 2), 2) +
      math.cos(radians(latitude)) *
          math.cos(radians(targetLat)) *
          math.pow(math.sin(deltaLng / 2), 2);
  return 6371 * 2 * math.asin(math.sqrt(arc));
}

({ClinicSummary clinic, double distanceKm})? nearestDoctorClinic(
    DoctorDirectoryItem doctor, double latitude, double longitude) {
  final distances = doctor.clinics
      .map((clinic) => (
            clinic: clinic,
            distanceKm: clinicDistanceKm(latitude, longitude, clinic)
          ))
      .where((item) => item.distanceKm != null)
      .map((item) => (clinic: item.clinic, distanceKm: item.distanceKm!))
      .toList()
    ..sort((a, b) => a.distanceKm.compareTo(b.distanceKm));
  return distances.isEmpty ? null : distances.first;
}
