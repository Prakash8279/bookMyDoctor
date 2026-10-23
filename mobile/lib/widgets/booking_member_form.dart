import 'package:flutter/material.dart';
import '../core/api_client.dart';
import '../core/india_time.dart';
import '../models/admin_models.dart';
import '../theme/app_theme.dart';
import 'common_widgets.dart';

class BookingMemberForm extends StatefulWidget {
  const BookingMemberForm(
      {super.key, required this.onSaved, required this.onCancel});
  final ValueChanged<FamilyMember> onSaved;
  final VoidCallback onCancel;
  @override
  State<BookingMemberForm> createState() => _BookingMemberFormState();
}

class _BookingMemberFormState extends State<BookingMemberForm> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _relation = TextEditingController();
  final _blood = TextEditingController();
  String? _dob;
  String? _gender;
  bool _saving = false;
  Object? _error;
  @override
  void dispose() {
    _name.dispose();
    _relation.dispose();
    _blood.dispose();
    super.dispose();
  }

  String? _required(String? value) =>
      value == null || value.trim().isEmpty ? 'Required' : null;
  Future<void> _save() async {
    if (_saving || !_form.currentState!.validate()) return;
    if (_dob == null) {
      setState(() => _error = 'Date of birth is required.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final response = await ApiClient.instance.post('/family-members', body: {
        'name': _name.text.trim(),
        'relation': _relation.text.trim(),
        'dateOfBirth': _dob,
        'gender': _gender,
        'bloodGroup': _blood.text.trim(),
      });
      if (mounted) widget.onSaved(FamilyMember.fromJson(response.map));
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Container(
        key: const ValueKey('booking-add-member'),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
            color: context.palette.background,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: context.palette.border)),
        child: Form(
            key: _form,
            child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextFormField(
                      controller: _name,
                      validator: _required,
                      maxLength: 150,
                      decoration: const InputDecoration(
                          labelText: 'Member name *', counterText: '')),
                  const SizedBox(height: 10),
                  TextFormField(
                      controller: _relation,
                      validator: _required,
                      maxLength: 50,
                      decoration: const InputDecoration(
                          labelText: 'Relationship *',
                          hintText: 'Self for yourself',
                          counterText: '')),
                  const SizedBox(height: 10),
                  OutlinedButton(
                      onPressed: _saving
                          ? null
                          : () async {
                              final date = await showDatePicker(
                                  context: context,
                                  initialDate: DateTime.tryParse(_dob ?? '') ??
                                      DateTime(2000),
                                  firstDate: DateTime(1900),
                                  lastDate: DateTime.parse(indiaToday()));
                              if (date != null && mounted) {
                                setState(() => _dob =
                                    '${date.year}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}');
                              }
                            },
                      child: Text(_dob ?? 'Member date of birth *')),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                      initialValue: _gender,
                      validator: _required,
                      isExpanded: true,
                      decoration:
                          const InputDecoration(labelText: 'Member gender *'),
                      items: const [
                        'Female',
                        'Male',
                        'Other',
                        'Prefer not to say'
                      ]
                          .map((value) => DropdownMenuItem(
                              value: value, child: Text(value)))
                          .toList(),
                      onChanged: _saving
                          ? null
                          : (value) => setState(() => _gender = value)),
                  const SizedBox(height: 10),
                  TextFormField(
                      controller: _blood,
                      validator: _required,
                      maxLength: 10,
                      decoration: const InputDecoration(
                          labelText: 'Member blood group *',
                          hintText: 'e.g. B+ or Unknown')),
                  if (_error != null) ErrorBanner(error: _error!),
                  Wrap(spacing: 8, children: [
                    ElevatedButton(
                        onPressed: _saving ? null : _save,
                        child: Text(_saving ? 'Saving…' : 'Save member')),
                    OutlinedButton(
                        onPressed: _saving ? null : widget.onCancel,
                        child: const Text('Cancel')),
                  ]),
                ])),
      );
}
