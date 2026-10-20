import { useEffect, useState } from 'react';
import { api } from '../services/api';

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    api.auditLogs().then(setLogs);
  }, []);

  return (
    <div>
      <h1 className="page-title">Audit Logs</h1>
      <table>
        <thead>
          <tr>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
            <th>Metadata</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td>{log.actor_user_id_5d ? `${log.actor_user_id_5d} · @${log.actor_username}` : 'system'}</td>
              <td>{log.action}</td>
              <td>
                {log.target_type} #{log.target_id}
              </td>
              <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{JSON.stringify(log.metadata)}</td>
              <td>{new Date(log.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
