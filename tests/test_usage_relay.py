import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import usage_telegram_relay as relay


class UsageRelayTest(unittest.TestCase):
    def test_hourly_export_uses_app_storage_and_never_copies_to_downloads(self):
        payload = {
            'schema': 'ai-usage-monitor/v1',
            'lastSyncAt': '2025-01-01T01:00:00Z',
            'lastSyncTrigger': 'hourly',
            'latest': {},
        }
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            downloads = home / 'Downloads'
            downloads.mkdir()
            data_dir = home / '.local' / 'share' / 'ai-usage-monitor'
            with (
                patch.object(Path, 'home', return_value=home),
                patch.object(relay, 'publish_to_contabo') as publish,
                patch.object(relay, 'format_message', return_value='Fixture digest'),
                patch.object(relay, 'notify_telegram') as notify,
            ):
                result = relay.handle_payload(payload, data_dir)

            latest = data_dir / 'latest.json'
            self.assertEqual(result, {'ok': True, 'saved': str(latest), 'notified': True})
            self.assertEqual(json.loads(latest.read_text(encoding='utf-8')), payload)
            publish.assert_called_once_with(latest)
            notify.assert_called_once_with('Fixture digest')
            self.assertFalse((downloads / 'ai-usage-monitor').exists())


if __name__ == '__main__':
    unittest.main()
