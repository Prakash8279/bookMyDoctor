import '../models/core_models.dart';

Uri? clinicDirectionsUri(ClinicSummary? summary, {Clinic? detail}) {
  if (summary == null && detail == null) return null;
  final latitude = detail?.latitude ?? summary?.latitude;
  final longitude = detail?.longitude ?? summary?.longitude;
  final hasPin = latitude != null &&
      longitude != null &&
      latitude.abs() <= 90 &&
      longitude.abs() <= 180;
  final destination = hasPin
      ? '$latitude,$longitude'
      : [
          detail?.name ?? summary?.name,
          detail?.address,
          detail?.area?.name ?? summary?.area,
          detail?.city?.name ?? summary?.city,
          'India',
        ].whereType<String>().where((part) => part.isNotEmpty).join(', ');
  return Uri.https('www.google.com', '/maps/dir/', {
    'api': '1',
    'destination': destination,
  });
}
